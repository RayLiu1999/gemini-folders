export const VERSION = 1;
export const MAX_DEPTH = 3;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const COLORS = ['blue', 'green', 'purple', 'amber', 'rose', 'gray'] as const;
export type Color = (typeof COLORS)[number];
export interface Folder {
  id: string; parentId: string | null; name: string; color: Color;
  createdAt: string; updatedAt: string;
}
export interface Chat {
  id: string; url: string; title: string; folderId: string | null;
  firstSeenAt: string; lastSeenAt: string;
}
export interface Workspace {
  id: string; name: string; revision: number; folders: Folder[]; chats: Chat[]; collapsedFolderIds: string[];
  sidebarCollapsed: boolean;
}
export interface Store { version: 1; workspaces: Workspace[] }
export interface ObservedChat { id: string; url: string; title: string }
export interface Backup {
  format: 'gemini-folders'; version: 1; exportedAt: string; workspace: Workspace;
}
export type Operation =
  | { type: 'create-folder'; name: string; parentId: string | null; color: Color }
  | { type: 'edit-folder'; id: string; name: string; parentId: string | null; color: Color }
  | { type: 'delete-folder'; id: string }
  | { type: 'set-collapsed'; ids: string[] }
  | { type: 'set-sidebar-collapsed'; collapsed: boolean }
  | { type: 'move-chats'; ids: string[]; folderId: string | null }
  | { type: 'ingest'; chats: ObservedChat[] }
  | { type: 'import'; backup: Backup; conflict: 'keep' | 'incoming' };

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), '資料格式不正確。');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 128): string {
  assert(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\p{Cc}]/u.test(value), '文字長度或內容不正確。');
  return value;
}
function id(value: unknown): string { const result = text(value); assert(ID.test(result), '識別碼格式不正確。'); return result; }
function nullableId(value: unknown): string | null { return value === null ? null : id(value); }
function date(value: unknown): string { const result = text(value, 40); assert(Number.isFinite(Date.parse(result)), '日期格式不正確。'); return result; }
function name(value: unknown): string { const result = text(value, 80).trim(); assert(result.length, '請輸入名稱。'); return result; }
function color(value: unknown): Color { assert(COLORS.includes(value as Color), '資料夾顏色不正確。'); return value as Color; }
function array(value: unknown, max: number): unknown[] { assert(Array.isArray(value) && value.length <= max, '資料筆數超過限制。'); return value; }
function flag(value: unknown): boolean { assert(typeof value === 'boolean', '側欄收合設定不正確。'); return value; }

export function parseChatUrl(value: unknown): { id: string; url: string } | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, 'https://gemini.google.com');
    if (url.origin !== 'https://gemini.google.com' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/(?:u\/\d+\/)?app\/([a-zA-Z0-9_-]{6,128})\/?$/);
    const chatId = match?.[1];
    return chatId ? { id: chatId, url: `https://gemini.google.com/app/${chatId}` } : null;
  } catch { return null; }
}

function observed(value: unknown): ObservedChat {
  const data = record(value);
  const parsed = parseChatUrl(data.url);
  assert(parsed && parsed.id === data.id, '聊天連結與識別碼不一致，或來源不是 Gemini。');
  return { ...parsed, title: text(data.title, 300).trim() || '未命名聊天' };
}

export function descendants(workspace: Workspace, folderId: string): Set<string> {
  const result = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of workspace.folders) {
      if (folder.parentId !== null && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id); changed = true;
      }
    }
  }
  return result;
}

export function folderDepth(workspace: Workspace, folderId: string): number {
  let current: string | null = folderId;
  const seen = new Set<string>();
  while (current !== null) {
    assert(!seen.has(current), '資料夾不能形成循環。');
    seen.add(current);
    const folder: Folder | undefined = workspace.folders.find(item => item.id === current);
    assert(folder, '找不到父資料夾。');
    current = folder.parentId;
  }
  return seen.size;
}

export function validateWorkspace(value: unknown): Workspace {
  const data = record(value);
  const workspace: Workspace = {
    id: id(data.id), name: name(data.name), revision: Number(data.revision), collapsedFolderIds: array(data.collapsedFolderIds ?? [], 1000).map(id),
    sidebarCollapsed: data.sidebarCollapsed === undefined ? false : flag(data.sidebarCollapsed),
    folders: array(data.folders, 1000).map(value => {
      const folder = record(value);
      return { id: id(folder.id), parentId: nullableId(folder.parentId), name: name(folder.name), color: color(folder.color), createdAt: date(folder.createdAt), updatedAt: date(folder.updatedAt) };
    }),
    chats: array(data.chats, 20000).map(value => {
      const chat = record(value);
      return { ...observed(chat), folderId: nullableId(chat.folderId), firstSeenAt: date(chat.firstSeenAt), lastSeenAt: date(chat.lastSeenAt) };
    }),
  };
  assert(Number.isSafeInteger(workspace.revision) && workspace.revision >= 0, '資料版本不正確。');
  const ids = workspace.folders.map(item => item.id);
  assert(workspace.collapsedFolderIds.every(item => ids.includes(item)), '收合設定指向不存在的資料夾。');
  assert(new Set(ids).size === ids.length, '資料夾識別碼重複。');
  assert(new Set(workspace.chats.map(item => item.id)).size === workspace.chats.length, '聊天識別碼重複。');
  const names = new Set<string>();
  for (const folder of workspace.folders) {
    assert(folderDepth(workspace, folder.id) <= MAX_DEPTH, `資料夾最多 ${MAX_DEPTH} 層。`);
    const key = JSON.stringify([folder.parentId, folder.name.toLocaleLowerCase()]);
    assert(!names.has(key), '同一層不能有同名資料夾。'); names.add(key);
  }
  for (const chat of workspace.chats) assert(chat.folderId === null || ids.includes(chat.folderId), '聊天指向不存在的資料夾。');
  return workspace;
}

export function parseStore(value: unknown): Store {
  if (value === undefined) return { version: VERSION, workspaces: [] };
  const data = record(value);
  assert(data.version === VERSION, '不支援此資料版本，請先更新插件；原資料不會被清除。');
  const workspaces = array(data.workspaces, 100).map(validateWorkspace);
  assert(new Set(workspaces.map(item => item.id)).size === workspaces.length, '工作區識別碼重複。');
  return { version: VERSION, workspaces };
}

export function parseBackup(value: unknown): Backup {
  const data = record(value);
  assert(data.format === 'gemini-folders' && data.version === VERSION, '這不是支援的 Gemini Folders 備份檔。');
  return { format: 'gemini-folders', version: VERSION, exportedAt: date(data.exportedAt), workspace: validateWorkspace(data.workspace) };
}

export function parseOperation(value: unknown): Operation {
  const data = record(value);
  switch (data.type) {
    case 'create-folder': return { type: data.type, name: name(data.name), parentId: nullableId(data.parentId), color: color(data.color) };
    case 'edit-folder': return { type: data.type, id: id(data.id), name: name(data.name), parentId: nullableId(data.parentId), color: color(data.color) };
    case 'delete-folder': return { type: data.type, id: id(data.id) };
    case 'set-collapsed': return { type: data.type, ids: array(data.ids, 1000).map(id) };
    case 'set-sidebar-collapsed': return { type: data.type, collapsed: flag(data.collapsed) };
    case 'move-chats': return { type: data.type, ids: array(data.ids, 20000).map(id), folderId: nullableId(data.folderId) };
    case 'ingest': return { type: data.type, chats: array(data.chats, 20000).map(observed) };
    case 'import': assert(data.conflict === 'keep' || data.conflict === 'incoming', '請選擇衝突處理方式。'); return { type: data.type, backup: parseBackup(data.backup), conflict: data.conflict };
    default: throw new Error('不支援此操作。');
  }
}

export function emptyWorkspace(workspaceId: string, workspaceName: string): Workspace {
  return { id: id(workspaceId), name: name(workspaceName), revision: 0, folders: [], chats: [], collapsedFolderIds: [], sidebarCollapsed: false };
}

export function backupOf(workspace: Workspace): Backup {
  return { format: 'gemini-folders', version: VERSION, exportedAt: new Date().toISOString(), workspace: structuredClone(workspace) };
}

export function applyOperation(workspace: Workspace, input: Operation, env: { now(): string; id(): string } = { now: () => new Date().toISOString(), id: () => crypto.randomUUID() }): Workspace {
  const op = parseOperation(input);
  const next = structuredClone(workspace);
  const now = env.now();
  switch (op.type) {
    case 'create-folder': next.folders.push({ id: env.id(), name: op.name, parentId: op.parentId, color: op.color, createdAt: now, updatedAt: now }); break;
    case 'edit-folder': {
      const folder = next.folders.find(item => item.id === op.id); assert(folder, '找不到資料夾，請重新整理。');
      Object.assign(folder, { name: op.name, parentId: op.parentId, color: op.color, updatedAt: now }); break;
    }
    case 'delete-folder': {
      assert(next.folders.some(item => item.id === op.id), '找不到資料夾。');
      const removed = descendants(next, op.id);
      next.folders = next.folders.filter(item => !removed.has(item.id));
      next.collapsedFolderIds = next.collapsedFolderIds.filter(item => !removed.has(item));
      for (const chat of next.chats) if (chat.folderId && removed.has(chat.folderId)) chat.folderId = null;
      break;
    }
    case 'set-collapsed': next.collapsedFolderIds = [...new Set(op.ids)]; break;
    case 'set-sidebar-collapsed': next.sidebarCollapsed = op.collapsed; break;
    case 'move-chats': {
      assert(op.folderId === null || next.folders.some(item => item.id === op.folderId), '找不到目的資料夾。');
      const selected = new Set(op.ids);
      assert(selected.size > 0 && [...selected].every(chatId => next.chats.some(item => item.id === chatId)), '選取的聊天已變更，請重新選取。');
      for (const chat of next.chats) if (selected.has(chat.id)) chat.folderId = op.folderId;
      break;
    }
    case 'ingest': {
      for (const item of op.chats) {
        const existing = next.chats.find(chat => chat.id === item.id);
        if (existing) Object.assign(existing, item, { lastSeenAt: now });
        else next.chats.push({ ...item, folderId: null, firstSeenAt: now, lastSeenAt: now });
      }
      break;
    }
    case 'import': {
      const mapping = new Map<string, string>();
      for (const folder of [...op.backup.workspace.folders].sort((a, b) => folderDepth(op.backup.workspace, a.id) - folderDepth(op.backup.workspace, b.id))) {
        const parentId = folder.parentId === null ? null : mapping.get(folder.parentId)!;
        const same = next.folders.find(item => item.id === folder.id) ?? next.folders.find(item => item.parentId === parentId && item.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase());
        if (same) mapping.set(folder.id, same.id);
        else { next.folders.push({ ...folder, parentId }); mapping.set(folder.id, folder.id); }
      }
      for (const chat of op.backup.workspace.chats) {
        const folderId = chat.folderId === null ? null : mapping.get(chat.folderId)!;
        const existing = next.chats.find(item => item.id === chat.id);
        if (!existing) next.chats.push({ ...chat, folderId });
        else if (op.conflict === 'incoming') Object.assign(existing, { title: chat.title, folderId });
      }
      break;
    }
  }
  next.revision++;
  return validateWorkspace(next);
}

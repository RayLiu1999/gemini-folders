import { backupOf, COLORS, descendants, folderDepth, MAX_BACKUP_BYTES, parseBackup, type Backup, type Chat, type Color, type Folder, type ObservedChat, type Operation, type Workspace } from './model';
import type { Client } from './client';
import type { WorkspaceSummary } from './repository';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const node = element('button', label, className); node.type = 'button'; node.addEventListener('click', action); return node;
}
function labelFor(text: string, control: HTMLElement): HTMLLabelElement {
  const label = element('label', text, 'gf-field'); label.append(control); return label;
}
export function folderPath(workspace: Workspace, folder: Folder): string {
  const names = [folder.name]; let parentId = folder.parentId;
  while (parentId) { const parent = workspace.folders.find(item => item.id === parentId); if (!parent) break; names.unshift(parent.name); parentId = parent.parentId; }
  return names.join(' / ');
}
export function downloadBackup(workspace: Workspace): void {
  const blob = new Blob([JSON.stringify(backupOf(workspace), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = element('a'); anchor.href = url; anchor.download = `gemini-folders-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export interface ManagerOptions {
  standalone?: boolean;
  currentChat?: () => ObservedChat | null;
  beforeChange?: (workspaceId: string) => Promise<void>;
  openChat?: (chat: Chat) => Promise<void>;
  onClose?: () => void;
}

export function mountManager(root: HTMLElement, client: Client, options: ManagerOptions = {}) {
  let workspace: Workspace | null = null;
  let workspaces: WorkspaceSummary[] = [];
  let folderFilter = 'all'; let query = ''; let selected = new Set<string>();
  let busy = false; let disposed = false; let message = ''; let failure = false;
  let selectionGeneration = 0;
  let blocked = '正在讀取工作區…';
  const shell = element('section', undefined, 'gf-shell'); root.append(shell);

  function status(text: string, error = false) { message = text; failure = error; render(); }
  async function change(operation: Operation) {
    const workspaceId = workspace?.id; if (!workspaceId || busy) return;
    busy = true; render();
    try {
      await options.beforeChange?.(workspaceId);
      if (workspace?.id !== workspaceId) throw new Error('工作區已切換，請重新操作。');
      const next = await client.change(workspaceId, operation);
      if (workspace?.id === workspaceId && !disposed) { if (next.revision >= workspace.revision) workspace = next; if (operation.type !== 'set-collapsed') selected.clear(); status('已儲存'); }
    } catch (error) { status(error instanceof Error ? error.message : '操作失敗，請稍後重試。', true); }
    finally { busy = false; if (!disposed) render(); }
  }
  function chooseFilter(value: string) { folderFilter = value; selected.clear(); render(); }
  function picker(label: string, firstLabel: string, exclude = new Set<string>()): HTMLSelectElement {
    const select = element('select'); select.setAttribute('aria-label', label);
    const unfiled = element('option', firstLabel); unfiled.value = ''; select.append(unfiled);
    for (const folder of [...(workspace?.folders ?? [])].sort((a, b) => folderPath(workspace!, a).localeCompare(folderPath(workspace!, b), 'zh-Hant'))) {
      if (exclude.has(folder.id)) continue;
      const item = element('option', folderPath(workspace!, folder)); item.value = folder.id; select.append(item);
    }
    return select;
  }
  function dialog(title: string, build: (body: HTMLDivElement, submit: HTMLButtonElement, close: () => void) => (event: SubmitEvent) => void) {
    const modal = element('dialog', undefined, 'gf-dialog');
    const form = element('form'); const heading = element('h2', title); heading.id = `dialog-${crypto.randomUUID()}`;
    modal.setAttribute('aria-labelledby', heading.id);
    const body = element('div', undefined, 'gf-dialog-body'); const footer = element('div', undefined, 'gf-actions');
    const previous = (root.getRootNode() as Document | ShadowRoot).activeElement;
    const close = () => { modal.close(); modal.remove(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
    const submit = element('button', '儲存', 'gf-primary'); submit.type = 'submit';
    footer.append(button('取消', close), submit); form.append(heading, body, footer); modal.append(form); root.append(modal);
    const onSubmit = build(body, submit, close);
    form.addEventListener('submit', event => { event.preventDefault(); onSubmit(event); });
    modal.addEventListener('cancel', event => { event.preventDefault(); close(); });
    modal.showModal();
  }
  function folderDialog(existing?: Folder) {
    if (!workspace) return;
    dialog(existing ? '編輯資料夾' : '新增資料夾', (body, _submit, close) => {
      const name = element('input'); name.required = true; name.maxLength = 80; name.value = existing?.name ?? ''; name.autofocus = true;
      const parent = picker('父資料夾', '最上層', existing ? descendants(workspace!, existing.id) : new Set());
      parent.value = existing?.parentId ?? (folderFilter !== 'all' && folderFilter !== 'unfiled' ? folderFilter : '');
      const color = element('select'); color.setAttribute('aria-label', '顏色');
      const labels = ['藍色', '綠色', '紫色', '琥珀色', '玫瑰色', '灰色'];
      COLORS.forEach((value, index) => { const option = element('option', labels[index]); option.value = value; color.append(option); }); color.value = existing?.color ?? 'blue';
      body.append(labelFor('名稱', name), labelFor('父資料夾', parent), labelFor('顏色', color), element('p', '最多三層；同一層的資料夾名稱須不同。', 'gf-muted'));
      return () => { if (!name.value.trim()) { name.focus(); return; } const common = { name: name.value.trim(), parentId: parent.value || null, color: color.value as Color }; close(); void change(existing ? { type: 'edit-folder', id: existing.id, ...common } : { type: 'create-folder', ...common }); };
    });
  }
  function moveDialog(ids: string[]) {
    if (!workspace || !ids.length) return;
    dialog(`移動 ${ids.length} 個聊天`, (body, submit, close) => {
      const target = picker('目的資料夾', '未分類'); submit.textContent = '移動';
      body.append(labelFor('目的資料夾', target));
      return () => { close(); void change({ type: 'move-chats', ids, folderId: target.value || null }); };
    });
  }
  function deleteDialog(folder: Folder) {
    if (!workspace) return;
    const removed = descendants(workspace, folder.id);
    const count = workspace.chats.filter(chat => chat.folderId && removed.has(chat.folderId)).length;
    dialog('刪除資料夾', (body, submit, close) => {
      body.append(element('p', `將移除「${folder.name}」及 ${removed.size - 1} 個子資料夾。${count} 個聊天會回到未分類，Gemini 原始對話會保留。`));
      submit.textContent = '刪除分類'; submit.className = 'gf-danger';
      return () => { close(); folderFilter = 'unfiled'; void change({ type: 'delete-folder', id: folder.id }); };
    });
  }
  function importDialog(backup: Backup) {
    if (!workspace) return;
    const existing = new Set(workspace.chats.map(chat => chat.id));
    const conflicts = backup.workspace.chats.filter(chat => existing.has(chat.id)).length;
    dialog('預覽備份匯入', (body, submit, close) => {
      body.append(element('p', `備份包含 ${backup.workspace.folders.length} 個資料夾、${backup.workspace.chats.length} 個聊天，其中 ${conflicts} 個聊天已存在。`));
      if (backup.workspace.id !== workspace!.id) body.append(element('p', '來源工作區不同，請確認這份備份的聊天屬於目前 Google 帳號。', 'gf-notice'));
      body.append(element('p', '同名同層資料夾會合併，既有資料夾名稱與結構保留。套用前會下載目前工作區的備份。', 'gf-muted'));
      const policy = element('select'); policy.setAttribute('aria-label', '聊天衝突處理');
      for (const [value, label] of [['keep', '保留現有聊天的分類'], ['incoming', '採用備份中的聊天分類']] as const) { const option = element('option', label); option.value = value; policy.append(option); }
      body.append(labelFor('聊天衝突處理', policy)); submit.textContent = '備份並匯入';
      return () => { if (!workspace) return; downloadBackup(workspace); close(); void change({ type: 'import', backup, conflict: policy.value as 'keep' | 'incoming' }); };
    });
  }
  async function loadFile(file: File) {
    const workspaceId = workspace?.id;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('備份檔不可超過 5 MB。');
      const backup = parseBackup(JSON.parse(await file.text()));
      if (!workspaceId || workspace?.id !== workspaceId) throw new Error('工作區已切換，請在目前工作區重新選擇備份檔。');
      importDialog(backup);
    } catch (error) { status(error instanceof Error ? error.message : '無法讀取備份。', true); }
  }
  async function selectWorkspace(id: string) {
    if (busy) return;
    const generation = ++selectionGeneration;
    workspace = null; blocked = '正在讀取工作區…'; selected.clear(); folderFilter = 'all'; closeDialogs(); render();
    try { const next = await client.read(id); if (!disposed && selectionGeneration === generation) { workspace = next; blocked = '請選擇工作區。'; render(); } }
    catch (error) { status(error instanceof Error ? error.message : '無法讀取工作區。', true); }
  }
  async function refreshList() { workspaces = await client.list(); if (!disposed) render(); }
  function newWorkspace() {
    dialog('新增手動工作區', (body, submit, close) => {
      const name = element('input'); name.required = true; name.maxLength = 80; name.autofocus = true;
      body.append(labelFor('工作區名稱', name), element('p', '手動工作區適合管理或匯入備份。Gemini 頁面的自動收錄會使用已辨識帳號對應的工作區。', 'gf-muted')); submit.textContent = '建立';
      return () => { if (!name.value.trim()) return; close(); void client.ensure(`manual-${crypto.randomUUID()}`, name.value.trim()).then(async next => { workspace = next; await refreshList(); render(); }).catch(error => status(String(error), true)); };
    });
  }
  function closeDialogs() { for (const node of root.querySelectorAll('dialog')) { node.close(); node.remove(); } }

  function render() {
    if (disposed) return;
    const focus = shell.querySelector<HTMLInputElement>('input:focus');
    const focusKey = focus?.dataset.focus; const selectionStart = focus?.selectionStart;
    shell.replaceChildren();
    const header = element('header', undefined, 'gf-header');
    const brand = element('div'); brand.append(element('span', 'G / F', 'gf-logo'), element('h1', '我的資料夾'), element('p', workspace?.name ?? 'Gemini Folders', 'gf-muted'));
    const actions = element('div', undefined, 'gf-actions');
    if (options.onClose) actions.append(button('關閉', options.onClose));
    header.append(brand, actions); shell.append(header);
    if (options.standalone) {
      const workspaceBar = element('div', undefined, 'gf-workspaces');
      const picker = element('select'); picker.setAttribute('aria-label', '工作區');
      const empty = element('option', '選擇工作區'); empty.value = ''; picker.append(empty);
      for (const item of workspaces) { const option = element('option', `${item.name} · ${item.id.slice(-6)}（${item.chatCount} 個聊天）`); option.value = item.id; picker.append(option); }
      picker.value = workspace?.id ?? ''; picker.disabled = busy; picker.addEventListener('change', () => { if (picker.value) void selectWorkspace(picker.value); else setWorkspace(null, '請選擇工作區。'); });
      workspaceBar.append(picker, button('新增手動工作區', newWorkspace)); shell.append(workspaceBar);
    }
    const live = element('p', message, failure ? 'gf-status gf-error' : 'gf-status'); live.setAttribute('role', failure ? 'alert' : 'status'); live.setAttribute('aria-live', 'polite'); shell.append(live);
    if (!workspace) { shell.append(element('div', blocked, 'gf-empty')); return; }
    const currentWorkspace = workspace;
    const toolbar = element('div', undefined, 'gf-toolbar');
    const search = element('input'); search.type = 'search'; search.placeholder = '搜尋聊天標題或資料夾'; search.setAttribute('aria-label', '搜尋聊天與資料夾'); search.dataset.focus = 'search'; search.value = query;
    search.addEventListener('input', () => { query = search.value; selected.clear(); render(); });
    const create = button('＋ 新增資料夾', () => folderDialog(), 'gf-primary'); create.disabled = busy;
    const backup = button('匯出備份', () => downloadBackup(currentWorkspace));
    const file = element('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    file.addEventListener('change', () => { if (file.files?.[0]) void loadFile(file.files[0]); });
    const upload = button('匯入備份', () => file.click()); upload.disabled = busy;
    toolbar.append(search, create, backup, upload, file); shell.append(toolbar);
    if (options.currentChat) {
      const current = options.currentChat();
      const add = button('將目前聊天加入資料夾', () => {
        const clickedChat = options.currentChat?.(); if (!clickedChat) return;
        void (async () => {
          await options.beforeChange?.(currentWorkspace.id);
          if (workspace?.id !== currentWorkspace.id) throw new Error('帳號已切換，請重新操作。');
          const next = await client.change(currentWorkspace.id, { type: 'ingest', chats: [clickedChat] });
          if (workspace?.id === currentWorkspace.id) { setWorkspace(next); moveDialog([clickedChat.id]); render(); }
        })().catch(error => status(error instanceof Error ? error.message : '無法收錄聊天。', true));
      });
      add.disabled = !current || busy; shell.append(add);
    }
    const layout = element('div', undefined, 'gf-layout'); const nav = element('nav', undefined, 'gf-folders'); nav.setAttribute('aria-label', '資料夾');
    function filterButton(label: string, value: string) { const node = button(label, () => chooseFilter(value), folderFilter === value ? 'gf-folder gf-active' : 'gf-folder'); node.setAttribute('aria-current', folderFilter === value ? 'page' : 'false'); return node; }
    nav.append(filterButton(`全部已收錄 · ${workspace.chats.length}`, 'all'), filterButton(`未分類 · ${workspace.chats.filter(chat => !chat.folderId).length}`, 'unfiled'));
    const needle = query.trim().toLocaleLowerCase();
    const matchingFolderIds = new Set(workspace.folders.filter(folder => folderPath(workspace!, folder).toLocaleLowerCase().includes(needle)).map(folder => folder.id));
    const ordered = [...workspace.folders].sort((a, b) => folderPath(workspace!, a).localeCompare(folderPath(workspace!, b), 'zh-Hant'));
    for (const folder of ordered) {
      if (needle && !matchingFolderIds.has(folder.id)) continue;
      let parent = folder.parentId; let hidden = false;
      while (parent) { if (workspace.collapsedFolderIds.includes(parent)) hidden = true; parent = workspace.folders.find(item => item.id === parent)?.parentId ?? null; }
      if (!needle && hidden) continue;
      const row = filterButton(`▱ ${folder.name} · ${workspace.chats.filter(chat => chat.folderId === folder.id).length}`, folder.id);
      row.dataset.color = folder.color; row.title = folderPath(workspace, folder);
      const wrapper = element('div', undefined, 'gf-folder-row'); wrapper.style.paddingInlineStart = `${(folderDepth(workspace, folder.id) - 1) * 12}px`;
      if (workspace.folders.some(item => item.parentId === folder.id)) {
        const collapsed = workspace.collapsedFolderIds.includes(folder.id);
        const toggle = button(collapsed ? '›' : '⌄', () => { void change({ type: 'set-collapsed', ids: collapsed ? currentWorkspace.collapsedFolderIds.filter(item => item !== folder.id) : [...currentWorkspace.collapsedFolderIds, folder.id] }); }, 'gf-toggle');
        toggle.setAttribute('aria-label', `${collapsed ? '展開' : '收合'} ${folder.name}`); toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.disabled = busy; wrapper.append(toggle);
      }
      wrapper.append(row); nav.append(wrapper);
    }
    const main = element('main', undefined, 'gf-main'); const chosenFolder = workspace.folders.find(folder => folder.id === folderFilter);
    const titleBar = element('div', undefined, 'gf-titlebar'); titleBar.append(element('h2', chosenFolder ? folderPath(workspace, chosenFolder) : folderFilter === 'unfiled' ? '未分類' : '全部已收錄'));
    if (chosenFolder) {
      const edit = button('編輯／移動資料夾', () => folderDialog(chosenFolder)); edit.disabled = busy;
      const remove = button('刪除分類', () => deleteDialog(chosenFolder)); remove.disabled = busy; titleBar.append(edit, remove);
    }
    main.append(titleBar);
    if (chosenFolder) {
      const children = element('div', undefined, 'gf-children');
      for (const child of workspace.folders.filter(item => item.parentId === chosenFolder.id)) children.append(button(`▱ ${child.name}`, () => chooseFilter(child.id)));
      main.append(children);
    }
    const visible = workspace.chats.filter(chat => (folderFilter === 'all' || (folderFilter === 'unfiled' ? chat.folderId === null : chat.folderId === folderFilter)) && (!needle || chat.title.toLocaleLowerCase().includes(needle) || (chat.folderId !== null && matchingFolderIds.has(chat.folderId)))).sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
    const selection = element('div', undefined, 'gf-selection');
    const selectAll = button(selected.size === visible.length && visible.length > 0 ? '取消全選' : '全選', () => { selected = selected.size === visible.length ? new Set() : new Set(visible.map(chat => chat.id)); render(); }); selectAll.disabled = !visible.length || busy;
    const move = button(`移動已選 ${selected.size} 個聊天`, () => moveDialog([...selected]), 'gf-primary'); move.disabled = !selected.size || busy;
    selection.append(selectAll, move, element('span', `顯示 ${visible.length} 個`, 'gf-muted')); main.append(selection);
    const list = element('ul', undefined, 'gf-chats');
    for (const chat of visible) {
      const row = element('li', undefined, 'gf-chat'); const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(chat.id); checkbox.disabled = busy; checkbox.setAttribute('aria-label', `選取 ${chat.title}`); checkbox.dataset.focus = chat.id;
      checkbox.addEventListener('change', () => { if (checkbox.checked) selected.add(chat.id); else selected.delete(chat.id); render(); });
      const link = element('a', chat.title); link.href = chat.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      if (options.openChat) link.addEventListener('click', event => { event.preventDefault(); void options.openChat!(chat).catch(error => status(error instanceof Error ? error.message : '無法開啟聊天。', true)); });
      const detail = element('div'); detail.append(link, element('span', chat.folderId ? folderPath(workspace, workspace.folders.find(folder => folder.id === chat.folderId)!) : '未分類', 'gf-muted'));
      row.append(checkbox, detail); list.append(row);
    }
    if (!visible.length) main.append(element('div', needle ? '沒有符合的聊天。可切換「全部已收錄」搜尋其他分類。' : '這裡還沒有聊天。開啟 Gemini 的既有對話即可收錄。', 'gf-empty'));
    main.append(list); layout.append(nav, main); shell.append(layout);
    shell.append(element('p', '僅搜尋已收錄聊天的標題；未載入的歷史紀錄不會自動出現在這裡。資料保存在本機，移除插件前請先匯出備份。', 'gf-footnote'));
    if (focusKey) { const target = [...shell.querySelectorAll<HTMLInputElement>('input[data-focus]')].find(node => node.dataset.focus === focusKey); target?.focus(); if (target?.type === 'search' && selectionStart !== null && selectionStart !== undefined) target.setSelectionRange(selectionStart, selectionStart); }
  }
  function setWorkspace(next: Workspace | null, reason = '無法辨識目前帳號，請重新整理或從管理頁選擇工作區。') {
    if (next?.id !== workspace?.id) { selectionGeneration++; selected.clear(); folderFilter = 'all'; query = ''; message = ''; closeDialogs(); }
    if (next && workspace?.id === next.id && next.revision < workspace.revision) return;
    workspace = next; blocked = reason; render();
  }
  async function refresh() {
    try {
      const id = workspace?.id;
      if (id) { const next = await client.read(id); if (!disposed && workspace?.id === id && next) setWorkspace(next); }
      if (options.standalone) await refreshList();
    } catch (error) { if (!disposed) status(error instanceof Error ? error.message : '無法重新載入資料夾。', true); }
  }
  if (options.standalone) {
    blocked = '選擇工作區開始整理。先在 Gemini 開啟側欄，插件會收錄已載入的聊天。';
    void refreshList().catch(error => status(String(error), true));
  }
  render();
  return { setWorkspace, refresh, selectFolder: chooseFilter, destroy() { disposed = true; closeDialogs(); shell.remove(); } };
}

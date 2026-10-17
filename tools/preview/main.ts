import { applyOperation, emptyWorkspace, type Store, type Workspace } from '../../src/model';
import { Repository, type WorkspaceSummary } from '../../src/repository';
import type { Client } from '../../src/client';
import { mountManager } from '../../src/ui';
import '../../src/style.css';
import '../../entrypoints/options/page.css';

const date = '2026-10-17T08:00:00.000Z';
let workspace = emptyWorkspace('preview-workspace', '我的聊天工作區');
for (const [id, name, parentId, color] of [
  ['work', '工作', null, 'blue'], ['project-a', '網站專案', 'work', 'green'], ['study', '學習', null, 'purple'], ['life', '生活', null, 'amber'],
] as const) workspace = applyOperation(workspace, { type: 'create-folder', name, parentId, color }, { now: () => date, id: () => id });
workspace = applyOperation(workspace, { type: 'ingest', chats: [
  { id: 'demoaaaaaaaaaaaa', title: '網站架構與登入流程', url: 'https://gemini.google.com/app/demoaaaaaaaaaaaa' },
  { id: 'demobbbbbbbbbbbb', title: 'TypeScript 學習筆記', url: 'https://gemini.google.com/app/demobbbbbbbbbbbb' },
  { id: 'democccccccccccc', title: '週末旅行規劃', url: 'https://gemini.google.com/app/democccccccccccc' },
] });
workspace = applyOperation(workspace, { type: 'move-chats', ids: ['demoaaaaaaaaaaaa'], folderId: 'project-a' });
let store: Store = { version: 1, workspaces: [workspace] };
const listeners = new Set<() => void>();
const repository = new Repository({ async read() { return structuredClone(store); }, async write(value) { store = structuredClone(value); for (const listener of listeners) listener(); } });
const client: Client = {
  async list() { return await repository.request({ kind: 'list' }) as WorkspaceSummary[]; },
  async read(workspaceId) { return await repository.request({ kind: 'read', workspaceId }) as Workspace | null; },
  async ensure(workspaceId, name) { return await repository.request({ kind: 'ensure', workspaceId, name }) as Workspace; },
  async change(workspaceId, operation) { return await repository.request({ kind: 'change', workspaceId, operation }) as Workspace; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
const manager = mountManager(document.querySelector<HTMLElement>('#app')!, client, { standalone: true });
manager.setWorkspace(workspace);
client.subscribe(() => { void manager.refresh(); });

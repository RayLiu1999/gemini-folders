import { applyOperation, emptyWorkspace, type Store, type Workspace } from '../src/model';
import { Repository } from '../src/repository';
import type { Client } from '../src/client';

let sequence = 0;
export const environment = { now: () => '2026-10-17T08:00:00.000Z', id: () => `folder-${++sequence}` };
export function sampleWorkspace(id = 'test-workspace'): Workspace {
  let result = emptyWorkspace(id, '測試工作區');
  result = applyOperation(result, { type: 'create-folder', name: '工作', parentId: null, color: 'blue' }, environment);
  return applyOperation(result, { type: 'ingest', chats: [
    { id: 'aaaaaaaaaaaaaaaa', title: '架構討論', url: 'https://gemini.google.com/app/aaaaaaaaaaaaaaaa' },
    { id: 'bbbbbbbbbbbbbbbb', title: '讀書計畫', url: 'https://gemini.google.com/app/bbbbbbbbbbbbbbbb' },
  ] }, environment);
}
export function memoryClient(initial = sampleWorkspace()) {
  let store: Store = { version: 1, workspaces: [structuredClone(initial)] };
  const listeners = new Set<() => void>();
  const repository = new Repository({
    async read() { return structuredClone(store); },
    async write(value) { store = structuredClone(value); for (const listener of listeners) listener(); },
  });
  const client: Client = {
    async list() { return await repository.request({ kind: 'list' }) as Awaited<ReturnType<Client['list']>>; },
    async read(workspaceId) { return await repository.request({ kind: 'read', workspaceId }) as Workspace | null; },
    async ensure(workspaceId, name) { return await repository.request({ kind: 'ensure', workspaceId, name }) as Workspace; },
    async change(workspaceId, operation) { return await repository.request({ kind: 'change', workspaceId, operation }) as Workspace; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { client, repository, store: () => store };
}

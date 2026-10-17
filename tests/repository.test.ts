import { describe, expect, it } from 'vitest';
import { Repository } from '../src/repository';
import { type Store, type Workspace } from '../src/model';
import { memoryClient, sampleWorkspace } from './fixtures';

describe('跨分頁與持久化', () => {
  it('同時從兩個分頁新增分類，不會覆蓋彼此寫入', async () => {
    const { client, store } = memoryClient();
    await Promise.all(['分頁 A', '分頁 B'].map(name => client.change('test-workspace', { type: 'create-folder', name, parentId: null, color: 'blue' })));
    expect(store().workspaces[0]!.folders.map(folder => folder.name)).toEqual(['工作', '分頁 A', '分頁 B']);
  });
  it('工作區隔離，重建 repository 後仍保留資料', async () => {
    const { client, store } = memoryClient(); await client.ensure('second-account', '另一帳號');
    await client.change('second-account', { type: 'create-folder', name: '私人', parentId: null, color: 'rose' });
    const restarted = new Repository({ async read() { return structuredClone(store()); }, async write() {} });
    const first = await restarted.request({ kind: 'read', workspaceId: 'test-workspace' }) as Workspace;
    const second = await restarted.request({ kind: 'read', workspaceId: 'second-account' }) as Workspace;
    expect(first.folders.map(folder => folder.name)).toEqual(['工作']); expect(second.chats).toHaveLength(0);
  });
  it('失敗的寫入不會污染已保存的資料，後續操作仍可繼續', async () => {
    let stored: Store = { version: 1, workspaces: [sampleWorkspace()] }; let fail = true;
    const repo = new Repository({ async read() { return structuredClone(stored); }, async write(next) { if (fail) throw new Error('quota'); stored = next; } });
    const input = { kind: 'change', workspaceId: 'test-workspace', operation: { type: 'create-folder', name: '新分類', parentId: null, color: 'blue' } };
    await expect(repo.request(input)).rejects.toThrow('quota'); expect(stored.workspaces[0]!.folders).toHaveLength(1);
    fail = false; await repo.request(input); expect(stored.workspaces[0]!.folders).toHaveLength(2);
  });
  it('拒絕未選工作區與損壞請求', async () => {
    const { repository } = memoryClient();
    await expect(repository.request({ kind: 'change', workspaceId: 'unknown', operation: {} })).rejects.toThrow(/找不到工作區/);
    await expect(repository.request({ kind: 'change', workspaceId: 'test-workspace', operation: { type: 'move-chats', ids: 'not-an-array', folderId: null } })).rejects.toThrow(/資料筆數/);
  });
});

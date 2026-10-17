import { applyOperation, emptyWorkspace, parseOperation, parseStore, type Store, type Workspace } from './model';

export interface WorkspaceSummary { id: string; name: string; chatCount: number }
export type Request =
  | { kind: 'list' }
  | { kind: 'read'; workspaceId: string }
  | { kind: 'ensure'; workspaceId: string; name: string }
  | { kind: 'change'; workspaceId: string; operation: unknown };
export interface Persistence { read(): Promise<unknown>; write(value: Store): Promise<void> }

/** All reads and writes share one queue, including across different workspaces. */
export class Repository {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly persistence: Persistence) {}

  request(input: unknown): Promise<Workspace | WorkspaceSummary[] | null> {
    const task = this.tail.then(() => this.perform(input));
    this.tail = task.catch(() => undefined);
    return task;
  }

  private async perform(input: unknown): Promise<Workspace | WorkspaceSummary[] | null> {
    if (!input || typeof input !== 'object') throw new Error('操作格式不正確。');
    const request = input as Record<string, unknown>;
    const store = parseStore(await this.persistence.read());
    if (request.kind === 'list') return store.workspaces.map(({ id, name, chats }) => ({ id, name, chatCount: chats.length }));
    const workspaceId = request.workspaceId;
    if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId)) throw new Error('請先選擇工作區。');
    const existing = store.workspaces.find(item => item.id === workspaceId);
    if (request.kind === 'read') return existing ?? null;
    if (request.kind === 'ensure') {
      if (existing) return existing;
      if (store.workspaces.length >= 100) throw new Error('工作區數量超過限制。');
      if (typeof request.name !== 'string') throw new Error('請輸入工作區名稱。');
      const created = emptyWorkspace(workspaceId, request.name);
      store.workspaces.push(created);
      await this.persistence.write(store);
      return created;
    }
    if (request.kind === 'change') {
      if (!existing) throw new Error('找不到工作區，請重新選取。');
      const next = applyOperation(existing, parseOperation(request.operation));
      store.workspaces[store.workspaces.indexOf(existing)] = next;
      await this.persistence.write(store);
      return next;
    }
    throw new Error('不支援此操作。');
  }
}

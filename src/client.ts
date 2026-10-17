import { browser } from 'wxt/browser';
import { validateWorkspace, type Operation, type Workspace } from './model';
import type { Request, WorkspaceSummary } from './repository';

export interface Client {
  list(): Promise<WorkspaceSummary[]>;
  read(id: string): Promise<Workspace | null>;
  ensure(id: string, name: string): Promise<Workspace>;
  change(id: string, operation: Operation): Promise<Workspace>;
  subscribe(listener: () => void): () => void;
}

export function createClient(): Client {
  async function send(request: Request): Promise<unknown> {
    const reply = await browser.runtime.sendMessage({ channel: 'gemini-folders', request }) as { ok: boolean; value?: unknown; error?: string } | undefined;
    if (!reply?.ok) throw new Error(reply?.error ?? '無法連線至插件，請重新整理 Gemini 頁面。');
    return reply.value;
  }
  return {
    async list() { return await send({ kind: 'list' }) as WorkspaceSummary[]; },
    async read(id) { const value = await send({ kind: 'read', workspaceId: id }); return value === null ? null : validateWorkspace(value); },
    async ensure(id, name) { return validateWorkspace(await send({ kind: 'ensure', workspaceId: id, name })); },
    async change(id, operation) { return validateWorkspace(await send({ kind: 'change', workspaceId: id, operation })); },
    subscribe(listener) {
      const port = browser.runtime.connect({ name: 'gemini-folders' });
      port.onMessage.addListener(listener);
      // Reconnect after a worker restart while the page remains open.
      let disposed = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let nextDispose: (() => void) | undefined;
      port.onDisconnect.addListener(() => {
        if (!disposed) retry = setTimeout(() => { if (!disposed) { listener(); nextDispose = createClient().subscribe(listener); } }, 1000);
      });
      return () => { disposed = true; clearTimeout(retry); nextDispose?.(); port.disconnect(); };
    },
  };
}

import type { Workspace } from './model';
import { folderPath } from './ui';

interface SidebarOptions {
  onToggle(workspaceId: string, collapsed: boolean): Promise<void>;
  onOpen(folderId?: string): void;
  onOpenOptions(): void;
}

export function mountSidebarSection(root: HTMLElement, options: SidebarOptions) {
  let workspace: Workspace | null = null;
  let pending: object | null = null;
  let failure = '';
  let disposed = false;
  const title = document.createElement('button'); title.type = 'button'; title.className = 'gf-sidebar-title';
  const label = document.createElement('span'); label.textContent = '▱ 我的資料夾';
  const arrow = document.createElement('span'); arrow.className = 'gf-sidebar-arrow'; arrow.setAttribute('aria-hidden', 'true');
  const list = document.createElement('div'); list.className = 'gf-sidebar-list'; list.id = `gf-sidebar-${crypto.randomUUID()}`;
  title.setAttribute('aria-controls', list.id); title.append(label, arrow);
  const status = document.createElement('p'); status.className = 'gf-sidebar-status'; status.setAttribute('role', 'alert');
  root.replaceChildren(title, list, status);

  function renderState() {
    const collapsed = workspace?.sidebarCollapsed ?? false;
    title.disabled = !workspace;
    title.setAttribute('aria-expanded', String(!collapsed));
    title.setAttribute('aria-busy', String(Boolean(pending)));
    title.setAttribute('aria-disabled', String(!workspace || Boolean(pending)));
    title.title = `${collapsed ? '展開' : '收合'}我的資料夾`;
    arrow.textContent = collapsed ? '›' : '⌄';
    list.hidden = collapsed;
    status.textContent = failure; status.hidden = !failure;
  }

  function renderList() {
    list.replaceChildren();
    if (workspace) {
      const current = workspace;
      for (const folder of [...current.folders].sort((a, b) => folderPath(current, a).localeCompare(folderPath(current, b), 'zh-Hant'))) {
        const item = document.createElement('button'); item.type = 'button'; item.textContent = folderPath(current, folder); item.title = folderPath(current, folder);
        item.addEventListener('click', () => options.onOpen(folder.id)); list.append(item);
      }
    }
    const manage = document.createElement('button'); manage.type = 'button'; manage.textContent = workspace ? `整理 ${workspace.chats.length} 個已收錄聊天 →` : '開啟整理面板 →';
    manage.addEventListener('click', () => options.onOpen()); list.append(manage);
    const settings = document.createElement('button'); settings.type = 'button'; settings.textContent = '獨立管理頁 ↗';
    settings.addEventListener('click', options.onOpenOptions); list.append(settings);
  }

  async function toggle() {
    if (!workspace || pending || disposed) return;
    const current = workspace; const request = {}; pending = request; failure = ''; renderState();
    try { await options.onToggle(current.id, !current.sidebarCollapsed); }
    catch (error) {
      if (!disposed && pending === request) failure = error instanceof Error ? error.message : '無法儲存收合設定，請再試一次。';
    } finally {
      if (!disposed && pending === request) { pending = null; renderState(); }
    }
  }
  title.addEventListener('click', () => { void toggle(); });
  renderList(); renderState();

  return {
    update(next: Workspace | null) {
      if (disposed || (workspace && next && workspace.id === next.id && next.revision < workspace.revision)) return;
      if (workspace?.id !== next?.id) { pending = null; failure = ''; }
      workspace = next; renderList(); renderState();
    },
    destroy() { disposed = true; pending = null; workspace = null; root.replaceChildren(); },
  };
}

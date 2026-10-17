import type { Workspace } from './model';
import { folderPath } from './ui';

interface SidebarOptions {
  onToggle(workspaceId: string, collapsed: boolean): Promise<void>;
  onOpen(folderId?: string): void;
  onOpenOptions(): void;
}

export function mountSidebarSection(root: HTMLElement, options: SidebarOptions) {
  let workspace: Workspace | null = null;
  const expandedFolderIds = new Set<string>();
  let pending: object | null = null;
  let failure = '';
  let disposed = false;
  const title = document.createElement('button'); title.type = 'button'; title.className = 'gf-sidebar-title';
  const label = document.createElement('span'); label.textContent = '▱ 我的資料夾';
  const arrow = document.createElement('span'); arrow.className = 'gf-sidebar-arrow'; arrow.setAttribute('aria-hidden', 'true');
  const list = document.createElement('div'); list.className = 'gf-sidebar-list'; list.id = `gf-sidebar-${crypto.randomUUID()}`;
  const tree = document.createElement('ul'); tree.className = 'gf-sidebar-tree'; tree.setAttribute('aria-label', '資料夾清單');
  const manage = document.createElement('button'); manage.type = 'button';
  manage.addEventListener('click', () => options.onOpen());
  const settings = document.createElement('button'); settings.type = 'button'; settings.textContent = '獨立管理頁 ↗';
  settings.addEventListener('click', options.onOpenOptions); list.append(tree, manage, settings);
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
    const active = (root.getRootNode() as Document | ShadowRoot).activeElement;
    const focused = active instanceof HTMLButtonElement && tree.contains(active) ? active : null;
    tree.replaceChildren();
    if (workspace) {
      const current = workspace;
      const ordered = [...current.folders].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      function renderChildren(parentId: string | null, container: HTMLUListElement) {
        for (const folder of ordered.filter(item => item.parentId === parentId)) {
          const entry = document.createElement('li'); const row = document.createElement('div'); row.className = 'gf-sidebar-folder-row';
          const item = document.createElement('button'); item.type = 'button'; item.className = 'gf-sidebar-folder-name'; item.textContent = folder.name; item.title = folderPath(current, folder);
          item.dataset.folderId = folder.id; item.dataset.action = 'open'; item.addEventListener('click', () => options.onOpen(folder.id));
          const children = document.createElement('ul'); children.className = 'gf-sidebar-children'; children.id = `gf-sidebar-children-${crypto.randomUUID()}`;
          if (ordered.some(child => child.parentId === folder.id)) {
            const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'gf-sidebar-folder-toggle';
            toggle.dataset.folderId = folder.id; toggle.dataset.action = 'toggle'; toggle.setAttribute('aria-controls', children.id);
            const updateExpanded = () => {
              const expanded = expandedFolderIds.has(folder.id); children.hidden = !expanded;
              toggle.textContent = expanded ? '⌄' : '›'; toggle.setAttribute('aria-expanded', String(expanded));
              toggle.setAttribute('aria-label', `${expanded ? '收合' : '展開'} ${folderPath(current, folder)}`);
            };
            toggle.addEventListener('click', () => {
              if (expandedFolderIds.has(folder.id)) expandedFolderIds.delete(folder.id); else expandedFolderIds.add(folder.id);
              updateExpanded();
            });
            updateExpanded(); row.append(toggle); renderChildren(folder.id, children);
          } else {
            const spacer = document.createElement('span'); spacer.className = 'gf-sidebar-folder-spacer'; spacer.setAttribute('aria-hidden', 'true'); row.append(spacer);
            children.hidden = true;
          }
          row.append(item); entry.append(row, children); container.append(entry);
        }
      }
      renderChildren(null, tree);
    }
    manage.textContent = workspace ? `整理 ${workspace.chats.length} 個已收錄聊天 →` : '開啟整理面板 →';
    if (focused) [...tree.querySelectorAll<HTMLButtonElement>('button')].find(item => item.dataset.folderId === focused.dataset.folderId && item.dataset.action === focused.dataset.action)?.focus();
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
      if (workspace?.id !== next?.id) { pending = null; failure = ''; expandedFolderIds.clear(); }
      for (const id of expandedFolderIds) if (!next?.folders.some(folder => folder.id === id)) expandedFolderIds.delete(id);
      workspace = next; renderList(); renderState();
    },
    destroy() { disposed = true; pending = null; workspace = null; root.replaceChildren(); },
  };
}

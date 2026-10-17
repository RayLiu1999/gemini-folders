import { browser } from 'wxt/browser';
import { createClient } from '../src/client';
import { AccountSession, accountIdentity, accountWorkspace, collectChats, findSidebar, sidebarAnchor } from '../src/gemini';
import { parseChatUrl, type Workspace } from '../src/model';
import { mountSidebarSection } from '../src/sidebar';
import { mountManager } from '../src/ui';
import css from '../src/style.css?inline';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    const client = createClient();
    const accountSession = new AccountSession();
    let activeId: string | null = null; let activeEmail: string | null = null;
    let snapshot: Workspace | null = null; let signature = ''; let syncing = false; let repeat = false;
    let sidebar: HTMLElement | null = null; let sideHost: HTMLElement | null = null;
    let sidebarSection: ReturnType<typeof mountSidebarSection> | null = null;
    const host = document.createElement('div'); host.dataset.geminiFolders = 'panel';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    const panel = document.createElement('dialog'); panel.className = 'gf-panel'; panel.setAttribute('aria-label', 'Gemini 資料夾管理');
    const app = document.createElement('div'); panel.append(app);
    const fallback = document.createElement('button'); fallback.className = 'gf-fallback'; fallback.textContent = '▱ 我的資料夾'; fallback.type = 'button';
    shadow.append(style, panel, fallback); document.body.append(host);

    function currentChat() {
      const parsed = parseChatUrl(location.href); if (!parsed) return null;
      return collectChats(sidebar).find(chat => chat.id === parsed.id) ?? { ...parsed, title: document.title.replace(/\s*[-–—]\s*Google Gemini\s*$/i, '').replace(/^Google Gemini$/i, '').trim().slice(0, 300) || '未命名聊天' };
    }
    function clearAccount(reason: string) {
      activeId = null; activeEmail = null; snapshot = null; signature = ''; manager.setWorkspace(null, reason); renderSidebar();
    }
    async function beforeChange(id: string) {
      const identity = accountIdentity(document);
      if (accountSession.observe(identity?.email ?? null) !== 'ready' || !activeId || id !== activeId || !activeEmail || identity?.email !== activeEmail) {
        clearAccount('帳號已變更或無法辨識，請重新整理 Gemini 頁面後再操作。');
        void synchronize(); throw new Error('帳號已變更，這次操作未套用。');
      }
    }
    const manager = mountManager(app, client, {
      currentChat,
      beforeChange,
      onClose: () => panel.close(),
      async openChat(chat) {
        if (!activeId) throw new Error('請先確認 Gemini 帳號。');
        await beforeChange(activeId);
        const native = sidebar && [...sidebar.querySelectorAll<HTMLAnchorElement>('a[href]')].find(anchor => parseChatUrl(anchor.href)?.id === chat.id);
        panel.close();
        if (native) native.click();
        else {
          const target = new URL(chat.url); const current = new URL(location.href);
          const prefix = current.pathname.match(/^\/u\/\d+/)?.[0];
          if (prefix) target.pathname = `${prefix}${target.pathname}`;
          for (const key of ['authuser', 'hl']) { const value = current.searchParams.get(key); if (value) target.searchParams.set(key, value); }
          location.assign(target.href);
        }
      },
    });
    function openPanel(folder = 'all') { manager.selectFolder(folder); if (!panel.open) panel.showModal(); }
    fallback.addEventListener('click', () => openPanel());

    function renderSidebar() {
      sidebarSection?.update(snapshot);
    }
    function mountSidebar() {
      if (!sidebar?.isConnected) sidebar = findSidebar(document);
      const anchor = sidebar ? sidebarAnchor(sidebar) : null;
      if (anchor && sidebar && !sideHost?.isConnected) {
        sidebarSection?.destroy(); sideHost?.remove(); sideHost = document.createElement('div'); sideHost.dataset.geminiFolders = 'sidebar';
        sideHost.style.color = getComputedStyle(sidebar).color;
        const sideShadow = sideHost.attachShadow({ mode: 'open' }); const sideStyle = document.createElement('style'); sideStyle.textContent = css;
        const sidebarUi = document.createElement('div'); sidebarUi.className = 'gf-sidebar'; sideShadow.append(sideStyle, sidebarUi); anchor.before(sideHost);
        sidebarSection = mountSidebarSection(sidebarUi, {
          async onToggle(id, collapsed) {
            await beforeChange(id);
            const next = await client.change(id, { type: 'set-sidebar-collapsed', collapsed });
            await beforeChange(id);
            if (ctx.isValid) showSnapshot(next);
          },
          onOpen: openPanel,
          onOpenOptions() { void browser.runtime.sendMessage({ channel: 'gemini-folders-open-options' }); },
        });
        renderSidebar();
      }
      fallback.hidden = Boolean(sideHost?.isConnected && sidebar && sidebar.getBoundingClientRect().width > 100);
      const dark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark-theme') || document.body.classList.contains('dark');
      const light = document.documentElement.classList.contains('light') || document.body.classList.contains('light-theme');
      app.className = dark ? 'gf-dark' : light ? 'gf-light' : '';
    }
    function showSnapshot(next: Workspace) {
      if (snapshot && snapshot.id === next.id && next.revision < snapshot.revision) return;
      snapshot = next; manager.setWorkspace(next); renderSidebar();
    }
    async function synchronize() {
      if (ctx.isInvalid) return;
      if (syncing) { repeat = true; return; }
      syncing = true;
      try {
        mountSidebar();
        const identity = accountIdentity(document);
        if (accountSession.observe(identity?.email ?? null) === 'changed') { clearAccount('偵測到頁面內切換帳號。請重新整理 Gemini，再收錄目前帳號的聊天。'); return; }
        if (!identity) { if (activeId || snapshot) clearAccount('目前無法辨識 Google 帳號。請重新整理頁面，或從插件工具列開啟獨立管理頁。'); else manager.setWorkspace(null, '目前無法辨識 Google 帳號。請重新整理頁面，或從插件工具列開啟獨立管理頁。'); return; }
        if (activeEmail && activeEmail !== identity.email) clearAccount('正在切換帳號對應的工作區…');
        const account = await accountWorkspace(identity);
        if (ctx.isInvalid || accountIdentity(document)?.email !== identity.email) { clearAccount('帳號正在變更，暫停收錄。'); return; }
        const chats = collectChats(sidebar);
        const current = currentChat(); if (current && !chats.some(chat => chat.id === current.id)) chats.push(current);
        const nextSignature = JSON.stringify([account.id, location.href, chats]);
        if (signature === nextSignature && activeId === account.id) return;
        activeId = account.id; activeEmail = identity.email;
        let next = await client.ensure(account.id, account.name);
        await beforeChange(account.id);
        if (chats.length) next = await client.change(account.id, { type: 'ingest', chats });
        await beforeChange(account.id);
        if (ctx.isInvalid) return;
        signature = nextSignature; showSnapshot(next);
      } catch (error) {
        if (ctx.isValid) manager.setWorkspace(null, error instanceof Error ? error.message : '無法載入資料夾，請重新整理頁面。');
      } finally { syncing = false; if (repeat && ctx.isValid) { repeat = false; ctx.setTimeout(() => { void synchronize(); }, 150); } }
    }
    const unsubscribe = client.subscribe(() => {
      const id = activeId; const email = activeEmail;
      if (!id || accountIdentity(document)?.email !== email) { void synchronize(); return; }
      void client.read(id).then(next => { if (next && ctx.isValid && activeId === id && accountIdentity(document)?.email === email) showSnapshot(next); }).catch(() => { /* Next synchronization will show the storage error. */ });
    });
    // Poll only account controls, URL, and the sidebar; never inspect message bodies.
    ctx.setInterval(() => { void synchronize(); }, 1200);
    void synchronize();
    ctx.onInvalidated(() => { unsubscribe(); manager.destroy(); sidebarSection?.destroy(); sideHost?.remove(); host.remove(); });
  },
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByRole, queryByRole, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import type { Client } from '../src/client';
import { mountSidebarSection } from '../src/sidebar';
import { memoryClient, sampleWorkspace } from './fixtures';

afterEach(() => document.body.replaceChildren());

function createRoot() { const root = document.createElement('div'); document.body.append(root); return root; }
function connect(root: HTMLElement, client: Client, onOpen = vi.fn(), onOpenOptions = vi.fn()) {
  const section = mountSidebarSection(root, {
    async onToggle(id, collapsed) { section.update(await client.change(id, { type: 'set-sidebar-collapsed', collapsed })); },
    onOpen, onOpenOptions,
  });
  return section;
}

describe('Gemini 側欄區塊', () => {
  it('用 Enter／空白鍵收合與展開，保留焦點並記住重新掛載前的狀態', async () => {
    const initial = sampleWorkspace(); const { client } = memoryClient(initial); const root = createRoot();
    let section = connect(root, client); section.update(initial);
    const user = userEvent.setup(); const title = getByRole(root, 'button', { name: '▱ 我的資料夾', expanded: true });
    title.focus(); await user.keyboard('{Enter}');
    await waitFor(() => expect(title.getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(title); expect(queryByRole(root, 'button', { name: '工作' })).toBeNull();
    expect(queryByRole(root, 'button', { name: '獨立管理頁 ↗' })).toBeNull();
    section.destroy(); section = connect(root, client); section.update((await client.read(initial.id))!);
    const restored = getByRole(root, 'button', { name: '▱ 我的資料夾', expanded: false });
    restored.focus(); await user.keyboard(' ');
    await waitFor(() => expect(restored.getAttribute('aria-expanded')).toBe('true'));
    expect(getByRole(root, 'button', { name: '工作' })).toBeTruthy(); expect(document.activeElement).toBe(restored);
    section.destroy();
  });

  it('收合後的背景更新保持收合，展開後可開啟資料夾、整理面板與獨立管理頁', async () => {
    const initial = sampleWorkspace(); const { client } = memoryClient(initial); const root = createRoot();
    const onOpen = vi.fn(); const onOpenOptions = vi.fn(); const section = connect(root, client, onOpen, onOpenOptions); section.update(initial);
    fireEvent.click(getByRole(root, 'button', { name: '▱ 我的資料夾' }));
    await waitFor(() => expect(getByRole(root, 'button', { name: '▱ 我的資料夾', expanded: false })).toBeTruthy());
    const updated = await client.change(initial.id, { type: 'ingest', chats: [{ id: 'cccccccccccccccc', title: '新聊天', url: 'https://gemini.google.com/app/cccccccccccccccc' }] });
    section.update(updated); section.update(initial);
    expect(getByRole(root, 'button', { name: '▱ 我的資料夾', expanded: false })).toBeTruthy();
    expect(queryByRole(root, 'button', { name: /整理/ })).toBeNull();
    fireEvent.click(getByRole(root, 'button', { name: '▱ 我的資料夾' }));
    await waitFor(() => expect(getByRole(root, 'button', { name: '整理 3 個已收錄聊天 →' })).toBeTruthy());
    fireEvent.click(getByRole(root, 'button', { name: '工作' })); expect(onOpen).toHaveBeenLastCalledWith(initial.folders[0]!.id);
    fireEvent.click(getByRole(root, 'button', { name: '整理 3 個已收錄聊天 →' })); expect(onOpen).toHaveBeenLastCalledWith();
    fireEvent.click(getByRole(root, 'button', { name: '獨立管理頁 ↗' })); expect(onOpenOptions).toHaveBeenCalledOnce(); section.destroy();
  });

  it('保存失敗時保持展開並顯示錯誤，重試成功後才收合', async () => {
    const initial = sampleWorkspace(); const { client } = memoryClient(initial); const root = createRoot();
    const change = vi.spyOn(client, 'change').mockRejectedValueOnce(new Error('無法儲存設定'));
    const section = connect(root, client); section.update(initial);
    const title = getByRole(root, 'button', { name: '▱ 我的資料夾' }); fireEvent.click(title);
    await waitFor(() => expect(getByRole(root, 'alert').textContent).toBe('無法儲存設定'));
    expect(title.getAttribute('aria-expanded')).toBe('true'); expect(getByRole(root, 'button', { name: '工作' })).toBeTruthy();
    fireEvent.click(title);
    await waitFor(() => expect(title.getAttribute('aria-expanded')).toBe('false'));
    expect(queryByRole(root, 'alert')).toBeNull(); expect(change).toHaveBeenCalledTimes(2); section.destroy();
  });

  it('等待保存時不重複送出，切換帳號後忽略舊操作的錯誤', async () => {
    const root = createRoot(); let reject!: (error: Error) => void;
    const onToggle = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const section = mountSidebarSection(root, { onToggle, onOpen: vi.fn(), onOpenOptions: vi.fn() }); section.update(sampleWorkspace());
    const title = getByRole(root, 'button', { name: '▱ 我的資料夾' }); fireEvent.click(title); fireEvent.click(title);
    expect(onToggle).toHaveBeenCalledOnce(); expect(title.getAttribute('aria-busy')).toBe('true');
    section.update({ ...sampleWorkspace('another-account'), sidebarCollapsed: true }); reject(new Error('舊帳號操作失敗'));
    await waitFor(() => expect(title.getAttribute('aria-busy')).toBe('false'));
    expect(queryByRole(root, 'alert')).toBeNull(); expect(title.getAttribute('aria-expanded')).toBe('false'); section.destroy();
  });
});

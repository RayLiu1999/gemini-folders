import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, getByLabelText, getByRole, getByText, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { mountManager } from '../src/ui';
import { memoryClient, sampleWorkspace } from './fixtures';

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => document.body.replaceChildren());

describe('使用者整理流程', () => {
  it('收合資料夾會隱藏子項，重新掛載後保留收合狀態', async () => {
    const { client } = memoryClient();
    const initial = (await client.read('test-workspace'))!;
    const ws = await client.change(initial.id, { type: 'create-folder', name: '子項', parentId: initial.folders[0]!.id, color: 'blue' });
    const root = document.createElement('div'); document.body.append(root); let manager = mountManager(root, client); manager.setWorkspace(ws);
    fireEvent.click(getByRole(root, 'button', { name: '收合 工作' }));
    await waitFor(() => expect(getByRole(root, 'button', { name: '展開 工作' })).toBeTruthy());
    expect(root.querySelector('.gf-folders')!.textContent).not.toContain('子項');
    manager.destroy(); manager = mountManager(root, client); manager.setWorkspace((await client.read(initial.id))!);
    expect(getByRole(root, 'button', { name: '展開 工作' })).toBeTruthy(); manager.destroy();
  });
  it('建立子資料夾、勾選聊天並批次移動，重新掛載後仍可看見分類', async () => {
    const { client } = memoryClient(); const root = document.createElement('div'); document.body.append(root);
    let manager = mountManager(root, client); manager.setWorkspace((await client.read('test-workspace'))!);
    const user = userEvent.setup();
    await user.click(getByRole(root, 'button', { name: '＋ 新增資料夾' }));
    const dialog = getByRole(root, 'dialog', { name: '新增資料夾' });
    await user.type(getByLabelText(dialog, '名稱'), '專案 A');
    const parent = getByLabelText(dialog, '父資料夾') as HTMLSelectElement;
    await user.selectOptions(parent, (await client.read('test-workspace'))!.folders[0]!.id);
    await user.click(getByRole(dialog, 'button', { name: '儲存' }));
    await waitFor(() => expect(getByRole(root, 'button', { name: /專案 A · 0/ })).toBeTruthy());
    await user.click(getByRole(root, 'checkbox', { name: '選取 架構討論' }));
    await user.click(getByRole(root, 'checkbox', { name: '選取 讀書計畫' }));
    await user.click(getByRole(root, 'button', { name: '移動已選 2 個聊天' }));
    const moving = getByRole(root, 'dialog', { name: '移動 2 個聊天' });
    const child = (await client.read('test-workspace'))!.folders.find(folder => folder.name === '專案 A')!;
    await user.selectOptions(getByLabelText(moving, '目的資料夾'), child.id);
    await user.click(getByRole(moving, 'button', { name: '移動' }));
    await waitFor(() => expect(getByRole(root, 'button', { name: /專案 A · 2/ })).toBeTruthy());
    manager.destroy(); manager = mountManager(root, client); manager.setWorkspace((await client.read('test-workspace'))!);
    expect(getByRole(root, 'button', { name: /專案 A · 2/ })).toBeTruthy(); manager.destroy();
  });
  it('搜尋保留輸入焦點，且用文字呈現不可信聊天標題', () => {
    const ws = sampleWorkspace(); ws.chats[0]!.title = '<img src=x onerror=alert(1)>';
    const { client } = memoryClient(ws); const root = document.createElement('div'); document.body.append(root);
    const manager = mountManager(root, client); manager.setWorkspace(ws);
    expect(getByRole(root, 'link', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy(); expect(root.querySelector('img')).toBeNull();
    const search = getByRole(root, 'searchbox'); search.focus(); fireEvent.input(search, { target: { value: '讀書' } });
    expect(document.activeElement).toBe(getByRole(root, 'searchbox')); expect(root.querySelectorAll('.gf-chat')).toHaveLength(1);
    manager.destroy();
  });
  it('帳號驗證失敗時不執行分類，顯示可理解的錯誤', async () => {
    const { client } = memoryClient(); const root = document.createElement('div'); document.body.append(root);
    const mutate = vi.spyOn(client, 'change');
    const manager = mountManager(root, client, { async beforeChange() { throw new Error('帳號已切換'); } }); manager.setWorkspace((await client.read('test-workspace'))!);
    fireEvent.click(getByRole(root, 'button', { name: '＋ 新增資料夾' }));
    const dialog = getByRole(root, 'dialog'); fireEvent.input(getByLabelText(dialog, '名稱'), { target: { value: '不能寫入' } }); fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(getByRole(root, 'alert').textContent).toBe('帳號已切換')); expect(mutate).not.toHaveBeenCalled(); manager.destroy();
  });
  it('用鍵盤開啟新增資料夾並取消後，可回到原按鈕', async () => {
    const { client } = memoryClient(); const root = document.createElement('div'); document.body.append(root);
    const manager = mountManager(root, client); manager.setWorkspace((await client.read('test-workspace'))!);
    const user = userEvent.setup(); const add = getByRole(root, 'button', { name: '＋ 新增資料夾' }); add.focus();
    await user.keyboard('{Enter}'); expect(getByRole(root, 'dialog', { name: '新增資料夾' })).toBeTruthy();
    await user.click(getByRole(root, 'button', { name: '取消' })); expect(document.activeElement).toBe(add); manager.destroy();
  });
  it('切換工作區後不顯示前一帳號的清單', async () => {
    const { client } = memoryClient(); const root = document.createElement('div'); document.body.append(root);
    const manager = mountManager(root, client); manager.setWorkspace((await client.read('test-workspace'))!);
    manager.setWorkspace(null, '正在確認帳號'); expect(getByText(root, '正在確認帳號')).toBeTruthy(); expect(root.querySelectorAll('.gf-chat')).toHaveLength(0); manager.destroy();
  });
});

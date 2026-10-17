import { afterEach, describe, expect, it } from 'vitest';
import { AccountSession, accountIdentity, collectChats, findSidebar, sidebarAnchor } from '../src/gemini';

afterEach(() => document.body.replaceChildren());
describe('Gemini 頁面辨識', () => {
  it('頁面內切換帳號後停止收錄，避免把尚未更新的側欄歸到新帳號', () => {
    const session = new AccountSession();
    expect(session.observe('a@example.test')).toBe('ready'); expect(session.observe(null)).toBe('missing');
    expect(session.observe('b@example.test')).toBe('changed'); expect(session.observe('b@example.test')).toBe('changed');
    expect(new AccountSession().observe('b@example.test')).toBe('ready');
  });
  it('只收錄側欄聊天連結，忽略分享連結、新對話及訊息正文', () => {
    document.body.innerHTML = `<aside aria-label="側邊導覽選單"><section><button aria-label="展開或收合「全部」">全部</button></section><a href="/app/aaaaaaaaaaaaaaaa?hl=zh-TW">聊天 A</a><a href="/app">新對話</a><a href="/share/aaaaaaaaaaaaaaaa">分享</a></aside><main><a href="/app/bbbbbbbbbbbbbbbb">正文中的連結</a></main>`;
    const sidebar = findSidebar(document);
    expect(collectChats(sidebar)).toEqual([{ id: 'aaaaaaaaaaaaaaaa', title: '聊天 A', url: 'https://gemini.google.com/app/aaaaaaaaaaaaaaaa' }]);
    expect(sidebarAnchor(sidebar!)).toBe(sidebar!.firstElementChild);
  });
  it('在實際觀察到的 expandable-section 外掛載，保留原生展開收合區塊', () => {
    document.body.innerHTML = '<mat-sidenav aria-label="側邊導覽選單"><expandable-section><div class="expandable-section-header-row"><button aria-label="展開或收合「全部」">全部</button></div></expandable-section></mat-sidenav>';
    expect(sidebarAnchor(findSidebar(document)!)).toBe(document.querySelector('expandable-section'));
  });
  it('只從帳號控制項辨識身分，不從聊天內容猜測', () => {
    document.body.innerHTML = `<main>example@example.test</main><button aria-label="Google 帳戶： Test User (person@example.test)"></button>`;
    expect(accountIdentity(document)).toEqual({ email: 'person@example.test', name: 'Test User' });
    document.body.innerHTML = '<main>Google 帳戶： Test User (person@example.test)</main>';
    expect(accountIdentity(document)).toBeNull();
  });
  it('登入切換期間出現兩個不同身分時停止辨識', () => {
    document.body.innerHTML = '<button aria-label="Google Account: A (a@example.test)"></button><button aria-label="Google Account: B (b@example.test)"></button>';
    expect(accountIdentity(document)).toBeNull();
  });
});

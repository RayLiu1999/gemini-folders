import { parseChatUrl, type ObservedChat } from './model';

/** After an in-page account switch, stale sidebar links cannot be attributed safely. */
export class AccountSession {
  private originalEmail: string | null = null;
  private changed = false;
  observe(email: string | null): 'ready' | 'missing' | 'changed' {
    if (this.changed) return 'changed';
    if (!email) return 'missing';
    if (this.originalEmail && this.originalEmail !== email) { this.changed = true; return 'changed'; }
    this.originalEmail = email;
    return 'ready';
  }
}

export function findSidebar(doc: Document): HTMLElement | null {
  const labelled = [...doc.querySelectorAll<HTMLElement>('[aria-label]')].find(element => /^(側邊導覽選單|Side navigation|Side navigation menu)$/i.test(element.getAttribute('aria-label') ?? ''));
  return labelled ?? doc.querySelector<HTMLElement>('bard-sidenav, mat-sidenav, [data-test-id="sidenav-container"], nav[aria-label]');
}

export function collectChats(sidebar: HTMLElement | null): ObservedChat[] {
  if (!sidebar) return [];
  const chats = new Map<string, ObservedChat>();
  for (const anchor of sidebar.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const parsed = parseChatUrl(anchor.href);
    const title = (anchor.querySelector('.conversation-title')?.textContent ?? anchor.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (parsed && title) chats.set(parsed.id, { ...parsed, title });
  }
  return [...chats.values()];
}

/** Only account controls are inspected. Chat text is never used for identity. */
export function accountIdentity(doc: Document): { email: string; name: string } | null {
  const identities = new Map<string, string>();
  for (const element of doc.querySelectorAll<HTMLElement>('a[aria-label], button[aria-label]')) {
    const label = element.getAttribute('aria-label') ?? '';
    if (!/^Google\s*(帳戶|帳號|Account)\s*[:：]/i.test(label)) continue;
    const email = label.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0].toLowerCase();
    if (email) identities.set(email, (label.replace(/^Google\s*(帳戶|帳號|Account)\s*[:：]\s*/i, '').split('(')[0] ?? '').trim().slice(0, 60) || 'Gemini');
  }
  if (identities.size !== 1) return null;
  const identity = [...identities][0]; if (!identity) return null;
  const [email, name] = identity;
  return { email, name };
}

export async function accountWorkspace(identity: { email: string; name: string }): Promise<{ id: string; name: string }> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity.email));
  return { id: `auto-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`, name: `${identity.name} 的聊天` };
}

export function sidebarAnchor(sidebar: HTMLElement): HTMLElement | null {
  const all = [...sidebar.querySelectorAll<HTMLElement>('button')].find(element => /^(展開或收合「全部」|Expand or collapse.*All|All chats)$/i.test(element.getAttribute('aria-label') ?? '') || element.textContent?.trim() === '全部');
  if (all) return all.closest<HTMLElement>('expandable-section, .conversation-list-header, .conversations-header') ?? all.parentElement;
  const first = [...sidebar.querySelectorAll<HTMLAnchorElement>('a[href]')].find(anchor => parseChatUrl(anchor.href));
  return first?.closest<HTMLElement>('.conversation-list, .conversations-container') ?? null;
}

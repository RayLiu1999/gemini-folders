import { browser } from 'wxt/browser';
import { Repository } from '../src/repository';

export default defineBackground(() => {
  const ports = new Set<ReturnType<typeof browser.runtime.connect>>();
  const ready = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const repository = new Repository({
    async read() { await ready; return (await browser.storage.local.get('gemini-folders-v1'))['gemini-folders-v1']; },
    async write(store) {
      await ready;
      await browser.storage.local.set({ 'gemini-folders-v1': store });
      for (const port of ports) { try { port.postMessage({ changed: true }); } catch { ports.delete(port); } }
    },
  });
  browser.runtime.onConnect.addListener(port => {
    if (port.name !== 'gemini-folders' || port.sender?.id !== browser.runtime.id) return;
    ports.add(port); port.onDisconnect.addListener(() => ports.delete(port));
  });
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || !message || typeof message !== 'object' || !('channel' in message)) return false;
    if (message.channel === 'gemini-folders-open-options') {
      void browser.runtime.openOptionsPage().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    }
    if (message.channel !== 'gemini-folders' || !('request' in message)) return false;
    void repository.request(message.request).then(
      value => sendResponse({ ok: true, value }),
      error => sendResponse({ ok: false, error: error instanceof Error ? error.message : '操作失敗，原有資料已保留。' }),
    );
    return true;
  });
  browser.action.onClicked.addListener(() => { void browser.runtime.openOptionsPage(); });
});

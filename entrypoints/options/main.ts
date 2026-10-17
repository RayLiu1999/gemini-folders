import { createClient } from '../../src/client';
import { mountManager } from '../../src/ui';
import '../../src/style.css';
import './page.css';

const client = createClient();
const manager = mountManager(document.querySelector<HTMLElement>('#app')!, client, { standalone: true });
const unsubscribe = client.subscribe(() => { void manager.refresh(); });
window.addEventListener('pagehide', () => { unsubscribe(); manager.destroy(); }, { once: true });

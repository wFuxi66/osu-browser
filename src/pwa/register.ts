// Registers the service worker (src/pwa/sw.js) in production builds, and offers to reload when a new version is
// ready. The new version never takes over by itself: a reload mid-edit would drop unsaved changes.
import { CHANGELOG } from '../changelog';
import { editor } from '../editor/store';
import { ask } from '../ui/prompt';

/** How often an open tab checks for a new version. */
const UPDATE_CHECK_MS = 1000 * 60 * 60;
/** How long to wait for a waiting worker's changelog (versions from before the changelog never answer). */
const CHANGELOG_WAIT_MS = 2000;

/** The changelog lines a waiting version has that this one doesn't. */
function newChanges(worker: ServiceWorker): Promise<string[]> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const own = new Set(CHANGELOG);
    ch.port1.onmessage = (e) => resolve(Array.isArray(e.data) ? e.data.filter((l) => typeof l === 'string' && !own.has(l)) : []);
    setTimeout(() => resolve([]), CHANGELOG_WAIT_MS);
    worker.postMessage('changelog', [ch.port2]);
  });
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => reloading && location.reload());
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    if (!reg) return;
    let offered = false;
    const reload = async () => {
      if (!(await editor.resolveUnsaved())) return;
      const waiting = reg.waiting;
      if (!waiting) return location.reload(); // another tab already switched to it
      reloading = true;
      waiting.postMessage('skip-waiting');
    };
    const offer = async () => {
      // Only an update: the first install has no page running an older version.
      if (offered || !reg.waiting || !navigator.serviceWorker.controller) return;
      offered = true;
      const changes = await newChanges(reg.waiting);
      editor.stickyToast(
        'A new version of osu!browser is available.',
        changes.length
          ? {
              label: "What's new",
              run: async () => {
                const r = await ask({
                  look: 'game',
                  title: "What's new",
                  list: changes,
                  buttons: [{ label: 'Reload now', value: 'reload', tone: 'pink' }, { label: 'Later', value: 'later' }],
                  cancelValue: 'later',
                });
                if (r === 'reload') await reload();
              },
            }
          : { label: 'Reload', run: reload },
      );
    };
    void offer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => w.state === 'installed' && void offer());
    });
    setInterval(() => navigator.onLine && void reg.update().catch(() => undefined), UPDATE_CHECK_MS);
  });
}

// Registers the service worker (src/pwa/sw.js) in production builds, and offers to reload when a new version is
// ready. The new version never takes over by itself: a reload mid-edit would drop unsaved changes.
import { editor } from '../editor/store';

/** How often an open tab checks for a new version. */
const UPDATE_CHECK_MS = 1000 * 60 * 60;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => reloading && location.reload());
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    if (!reg) return;
    let offered = false;
    const offer = () => {
      // Only an update: the first install has no page running an older version.
      if (offered || !reg.waiting || !navigator.serviceWorker.controller) return;
      offered = true;
      editor.stickyToast('A new version of osu!browser is available.', {
        label: 'Reload',
        run: async () => {
          if (!(await editor.resolveUnsaved())) return;
          const waiting = reg.waiting;
          if (!waiting) return location.reload(); // another tab already switched to it
          reloading = true;
          waiting.postMessage('skip-waiting');
        },
      });
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => w.state === 'installed' && offer());
    });
    setInterval(() => navigator.onLine && void reg.update().catch(() => undefined), UPDATE_CHECK_MS);
  });
}

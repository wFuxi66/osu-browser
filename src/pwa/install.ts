// "Install as an app": Chrome and Edge fire beforeinstallprompt when the page can be installed (desktop icon, own
// window). We keep the event and let Options → Maintenance trigger it. Other browsers never fire it, so the button
// stays hidden there.
import { useSyncExternalStore } from 'react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
}

let pending: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pending = e as InstallEvent;
  emit();
});
window.addEventListener('appinstalled', () => {
  pending = null;
  emit();
});

export async function installApp() {
  const e = pending;
  if (!e) return;
  pending = null; // an event can only be prompted once
  emit();
  await e.prompt();
}

export const useCanInstall = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => pending !== null,
  );

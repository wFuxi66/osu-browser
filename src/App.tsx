import { useEffect, useSyncExternalStore } from 'react';
import { hitsounds } from './audio/hitsounds';
import { EditorShell } from './editor/ui/EditorShell';
import { Home } from './editor/ui/Home';
import { Toasts } from './editor/ui/Toasts';
import { useEditor } from './editor/store';
import { cloud } from './project/cloud';

export function useCloud() {
  return useSyncExternalStore(
    (l) => cloud.onChange(l),
    () => cloud.user?.id ?? (cloud.available ? 0 : -1),
  );
}

export function App() {
  const ed = useEditor();
  useEffect(() => {
    void cloud.init();
    // The AudioContext can only start after a user gesture.
    const unlock = () => hitsounds.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }, []);

  return (
    <>
      {ed.hasProject ? <EditorShell /> : <Home />}
      <Toasts />
    </>
  );
}

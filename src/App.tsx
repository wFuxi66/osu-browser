import { useEffect, useSyncExternalStore } from 'react';
import { hitsounds } from './audio/hitsounds';
import { EditorShell } from './editor/ui/EditorShell';
import { Toasts } from './editor/ui/Toasts';
import { useEditor } from './editor/store';
import { cloud } from './project/cloud';
import { SongSelect } from './songselect/SongSelect';
import { PromptHost } from './ui/PromptHost';

export function useCloud() {
  return useSyncExternalStore(
    (l) => cloud.onChange(l),
    () => cloud.user?.id ?? (cloud.available ? 0 : -1),
  );
}

/** Two screens, like stable's edit flow: song select (edit mode) and the editor. */
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
      {ed.hasProject ? <EditorShell /> : <SongSelect />}
      <Toasts />
      <PromptHost />
    </>
  );
}

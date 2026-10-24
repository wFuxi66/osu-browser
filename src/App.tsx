import { useEffect, useSyncExternalStore } from 'react';
import { hitsounds } from './audio/hitsounds';
import { EditorShell } from './editor/ui/EditorShell';
import { Toasts } from './editor/ui/Toasts';
import { editor, useEditor } from './editor/store';
import { cloud } from './project/cloud';
import { skins } from './skin/skin';
import { SongSelect } from './songselect/SongSelect';
import { OptionsPanel } from './ui/OptionsPanel';
import { PromptHost } from './ui/PromptHost';
import { VolumeControl } from './ui/VolumeControl';

export function useCloud() {
  return useSyncExternalStore(
    (l) => cloud.onChange(l),
    () => (cloud.available ? `${cloud.user?.id ?? 0}:${cloud.driveConnected}` : 'offline'),
  );
}

/** Two screens, like stable's edit flow: song select (edit mode) and the editor. */
export function App() {
  const ed = useEditor();
  useEffect(() => {
    void cloud.init();
    void skins.use(editor.prefs.skin);
    // The AudioContext can only start after a user gesture.
    const unlock = () => hitsounds.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }, []);

  return (
    <>
      {ed.hasProject ? <EditorShell /> : <SongSelect />}
      <OptionsPanel />
      <Toasts />
      <PromptHost />
      <VolumeControl />
    </>
  );
}

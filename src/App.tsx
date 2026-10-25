import { useEffect, useSyncExternalStore } from 'react';
import { hitsounds } from './audio/hitsounds';
import { EditorShell } from './editor/ui/EditorShell';
import { Toasts } from './editor/ui/Toasts';
import { editor, useEditor } from './editor/store';
import { cloud } from './project/cloud';
import { skins } from './skin/skin';
import { MainMenu } from './menu/MainMenu';
import { Player } from './play/Player';
import { SongSelect } from './songselect/SongSelect';
import { screens, useScreens } from './ui/screens';
import { OptionsPanel } from './ui/OptionsPanel';
import { PromptHost } from './ui/PromptHost';
import { VolumeControl } from './ui/VolumeControl';
import { FullscreenButton, RotateHint } from './ui/TouchChrome';

export function useCloud() {
  return useSyncExternalStore(
    (l) => cloud.onChange(l),
    () => (cloud.available ? `${cloud.user?.id ?? 0}:${cloud.driveConnected}` : 'offline'),
  );
}

/** Stable's flow: the main menu, song select (play or edit mode), then the game or the editor. */
export function App() {
  const ed = useEditor();
  const scr = useScreens();
  useEffect(() => {
    // Back from connecting Google Drive: song select shows the result and syncs.
    if (new URLSearchParams(location.search).has('drive')) screens.select('edit');
    void cloud.init();
    void skins.use(editor.prefs.skin);
    // The AudioContext can only start after a user gesture.
    const unlock = () => hitsounds.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }, []);

  return (
    <>
      {ed.hasProject ? (
        ed.session === 'play' ? <Player mode="play" /> : <EditorShell />
      ) : scr.screen === 'menu' ? (
        <MainMenu />
      ) : (
        <SongSelect key={scr.mode} mode={scr.mode} />
      )}
      <OptionsPanel />
      <Toasts />
      <PromptHost />
      <VolumeControl />
      {!ed.hasProject && scr.screen === 'menu' && <FullscreenButton />}
      <RotateHint />
    </>
  );
}

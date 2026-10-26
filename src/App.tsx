import { useEffect, useSyncExternalStore } from 'react';
import { hitsounds } from './audio/hitsounds';
import { EditorShell } from './editor/ui/EditorShell';
import { Toasts } from './editor/ui/Toasts';
import { editor, useEditor } from './editor/store';
import { cloud } from './project/cloud';
import { openMapLink, takeMapLink } from './project/deeplink';
import { skins } from './skin/skin';
import { applySkinCursor } from './skin/cursor';
import { MainMenu } from './menu/MainMenu';
import { Player } from './play/Player';
import { SongSelect } from './songselect/SongSelect';
import { useBackButton } from './ui/backButton';
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
  useBackButton(ed.hasProject || scr.screen !== 'menu');
  // Mapping (not test play) uses osu!default when that option is on.
  const mapping = ed.hasProject && ed.session === 'edit' && ed.dialog !== 'test';
  useEffect(() => void skins.setEditorDefault(mapping && ed.prefs.editorDefaultSkin), [mapping, ed.prefs.editorDefaultSkin]);
  const cursorSize = ed.prefs.cursorSize;
  useEffect(() => {
    const apply = () => applySkinCursor(cursorSize);
    apply();
    window.addEventListener('resize', apply);
    const off = skins.onChange(apply);
    return () => {
      window.removeEventListener('resize', apply);
      off();
    };
  }, [cursorSize]);
  useEffect(() => {
    // Back from connecting Google Drive: song select shows the result and syncs.
    if (new URLSearchParams(location.search).has('drive')) screens.select('edit');
    // Opened from an osu.ppy.sh beatmap page (userscript or bookmarklet): straight into the editor.
    const link = takeMapLink();
    void cloud.init().then(() => link && openMapLink(link));
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

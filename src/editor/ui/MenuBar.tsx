import { useEffect, useRef, useState } from 'react';
import { useCloud } from '../../App';
import { music } from '../../audio/music';
import { serializeBeatmap } from '../../osu/serializer';
import { cloud } from '../../project/cloud';
import { downloadBlob, downloadText, exportOsz, osuFilename, oszFilename, projectTitle } from '../../project/project';
import { autoBreaks } from '../breaks';
import { editor, GRID_SIZES, useEditor, type Screen } from '../store';

interface Item {
  label: string;
  shortcut?: string;
  action?: () => void;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

function Menu({ title, items }: { title: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`menu-title ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        {title}
      </button>
      {open && (
        <div className="menu-items">
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                className="menu-item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.action?.();
                }}
              >
                <span className="check">{it.checked ? '✓' : ''}</span>
                <span className="menu-label">{it.label}</span>
                {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const sep: Item = { label: '', separator: true };

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

export function MenuBar() {
  const ed = useEditor();
  useCloud();
  const bm = ed.bm;
  const hasSel = ed.selection.size > 0;
  const p = ed.prefs;

  const exportPackage = async () => {
    await editor.flushAutosave();
    downloadBlob(await exportOsz(editor.project!), oszFilename(editor.project!));
  };

  const file: Item[] = [
    { label: 'Save', shortcut: 'Ctrl+S', action: () => void ed.save() },
    { label: 'Revert to saved', shortcut: 'Ctrl+L', action: () => ed.revertToSaved() },
    sep,
    { label: 'Create new difficulty…', action: () => ed.openDialog('newDifficulty') },
    { label: 'Open difficulty…', shortcut: 'Ctrl+O', action: () => ed.openDialog('difficulties') },
    sep,
    { label: 'Export package (.osz)', action: () => void exportPackage() },
    { label: 'Export difficulty (.osu)', action: () => downloadText(serializeBeatmap(bm), osuFilename(bm)) },
    sep,
    { label: 'Replace audio file…', action: async () => { const [f] = await pickFiles('audio/*,.mp3,.ogg', false); if (f) await ed.replaceAudio(f); } },
    {
      label: 'Add files to beatmap folder…',
      action: async () => {
        const files = await pickFiles('*', true);
        for (const f of files) ed.setFile(f.name, f);
        if (files.length) ed.toast(`Added ${files.length} file${files.length > 1 ? 's' : ''}. Custom hitsounds are picked up by name (e.g. soft-hitclap2.wav).`);
        const { hitsounds } = await import('../../audio/hitsounds');
        await hitsounds.setCustomSamples(ed.project!.files, bm.general.audioFilename);
      },
    },
    { label: 'Manage beatmap files…', action: () => ed.openDialog('export') },
    sep,
    { label: 'Test beatmap', shortcut: 'F5', action: () => { music.pause(); ed.openDialog('test'); } },
    sep,
    { label: 'Close (back to beatmap list)', action: () => ed.closeProject() },
  ];

  const edit: Item[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: () => ed.undo(), disabled: !ed.canUndo },
    { label: 'Redo', shortcut: 'Ctrl+Y', action: () => ed.redo(), disabled: !ed.canRedo },
    sep,
    { label: 'Cut', shortcut: 'Ctrl+X', action: () => ed.copy(true), disabled: !hasSel },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => ed.copy(), disabled: !hasSel },
    { label: 'Paste', shortcut: 'Ctrl+V', action: () => ed.paste() },
    { label: 'Delete', shortcut: 'Del', action: () => ed.deleteSelection(), disabled: !hasSel },
    { label: 'Select all', shortcut: 'Ctrl+A', action: () => ed.selectAll() },
    { label: 'Clone', shortcut: 'Ctrl+D', action: () => ed.cloneSelection(), disabled: !hasSel },
    sep,
    { label: 'Reverse selection', shortcut: 'Ctrl+G', action: () => ed.reverseSelection(), disabled: !hasSel },
    { label: 'Flip horizontally', shortcut: 'Ctrl+H', action: () => ed.flip(true), disabled: !hasSel },
    { label: 'Flip vertically', shortcut: 'Ctrl+J', action: () => ed.flip(false), disabled: !hasSel },
    { label: 'Rotate 90° clockwise', shortcut: 'Ctrl+.', action: () => ed.rotate(90, 'playfield'), disabled: !hasSel },
    { label: 'Rotate 90° anticlockwise', shortcut: 'Ctrl+,', action: () => ed.rotate(-90, 'playfield'), disabled: !hasSel },
    { label: 'Rotate by…', shortcut: 'Ctrl+Shift+R', action: () => ed.openDialog('rotate'), disabled: !hasSel },
    { label: 'Scale by…', shortcut: 'Ctrl+Shift+S', action: () => ed.openDialog('scale'), disabled: !hasSel },
    sep,
    { label: 'Nudge backward', shortcut: 'J', action: () => ed.nudgeTime(-1), disabled: !hasSel },
    { label: 'Nudge forward', shortcut: 'K', action: () => ed.nudgeTime(1), disabled: !hasSel },
    { label: 'Resnap selected notes', action: () => ed.resnapObjects(false), disabled: !hasSel },
    { label: 'Resnap all notes', action: () => ed.resnapObjects(true) },
    {
      label: 'Reset all hitsound samples',
      action: () =>
        confirm('Reset sample sets, volumes and custom indices of all objects to "auto"?') &&
        ed.commit((b) =>
          b.hitObjects.forEach((o) => {
            o.sample = { normalSet: 0, additionSet: 0, index: 0, volume: 0, filename: '' };
            if (o.kind === 'slider') o.edgeSets = o.edgeSets.map(() => ({ normal: 0, addition: 0 }));
          }),
        ),
    },
    { label: 'Remove all hit objects', shortcut: 'Ctrl+N', action: () => confirm('Remove all hit objects from this difficulty?') && ed.removeAllObjects() },
  ];

  const view: Item[] = [
    { label: 'Compose', shortcut: 'F1', action: () => ed.setScreen('compose'), checked: ed.screen === 'compose' },
    { label: 'Design', shortcut: 'F2', action: () => ed.setScreen('design'), checked: ed.screen === 'design' },
    { label: 'Timing', shortcut: 'F3', action: () => ed.setScreen('timing'), checked: ed.screen === 'timing' },
    { label: 'Song setup…', shortcut: 'F4', action: () => ed.openDialog('setup') },
    { label: 'Timing and control points…', shortcut: 'F6', action: () => ed.openDialog('timingPoints') },
    sep,
    { label: 'Hit animations', checked: p.showHitAnimations, action: () => ed.setPrefs({ showHitAnimations: !p.showHitAnimations }) },
    { label: 'Follow points', checked: p.showFollowPoints, action: () => ed.setPrefs({ showFollowPoints: !p.showFollowPoints }) },
    { label: 'Snaking sliders', checked: p.snakingSliders, action: () => ed.setPrefs({ snakingSliders: !p.snakingSliders }) },
    { label: 'Background dim: 0%', checked: p.backgroundDim === 0, action: () => ed.setPrefs({ backgroundDim: 0 }) },
    { label: 'Background dim: 30%', checked: p.backgroundDim === 0.3, action: () => ed.setPrefs({ backgroundDim: 0.3 }) },
    { label: 'Background dim: 50%', checked: p.backgroundDim === 0.5, action: () => ed.setPrefs({ backgroundDim: 0.5 }) },
    { label: 'Background dim: 70%', checked: p.backgroundDim === 0.7, action: () => ed.setPrefs({ backgroundDim: 0.7 }) },
    { label: 'Background dim: 100%', checked: p.backgroundDim === 1, action: () => ed.setPrefs({ backgroundDim: 1 }) },
    sep,
    { label: 'Preferences…', action: () => ed.openDialog('preferences') },
    { label: 'Keyboard shortcuts…', action: () => ed.openDialog('shortcuts') },
  ];

  const compose: Item[] = [
    { label: 'Grid snap', shortcut: 'T', checked: ed.gridSnap, action: () => { ed.gridSnap = !ed.gridSnap; ed.emit(); } },
    { label: 'Distance snap', shortcut: 'Y', checked: ed.distanceSnap, action: () => { ed.distanceSnap = !ed.distanceSnap; ed.emit(); } },
    { label: 'Lock notes', shortcut: 'L', checked: ed.locked, action: () => { ed.locked = !ed.locked; ed.emit(); } },
    sep,
    ...GRID_SIZES.map((g, i) => ({ label: `Grid size: ${['Tiny', 'Small', 'Medium', 'Large'][i]}`, shortcut: `Ctrl+${i + 1}`, checked: ed.gridSize === g, action: () => ed.setGridSize(g) })),
    sep,
    { label: 'Create polygon circles…', shortcut: 'Ctrl+Shift+D', action: () => ed.openDialog('polygon') },
    { label: 'Convert slider to stream…', shortcut: 'Ctrl+Shift+F', action: () => ed.openDialog('stream'), disabled: !hasSel },
    sep,
    { label: 'AiMod (verify beatmap)…', shortcut: 'Ctrl+Shift+A', action: () => ed.openDialog('aimod') },
  ];

  const timing: Item[] = [
    { label: 'Add timing point (red line)', shortcut: 'Ctrl+P', action: () => ed.addTimingPoint(true) },
    { label: 'Add inherited point (green line)', shortcut: 'Ctrl+Shift+P', action: () => ed.addTimingPoint(false) },
    { label: 'Delete current timing section', shortcut: 'Ctrl+I', action: () => ed.removeTimingPointAt(music.time) },
    { label: 'Timing and control points…', shortcut: 'F6', action: () => ed.openDialog('timingPoints') },
    { label: 'Metronome', checked: ed.metronome, action: () => { ed.metronome = !ed.metronome; ed.emit(); } },
    sep,
    { label: 'Add bookmark', shortcut: 'Ctrl+B', action: () => ed.addBookmark() },
    { label: 'Remove bookmark', shortcut: 'Ctrl+Shift+B', action: () => ed.removeBookmark() },
    { label: 'Remove all bookmarks', action: () => ed.commit((b) => (b.editor.bookmarks = [])) },
    sep,
    { label: 'Set preview point to current time', action: () => ed.commit((b) => (b.general.previewTime = Math.round(music.time))) },
    { label: 'Recalculate break periods', action: () => ed.commit((b) => (b.events.breaks = autoBreaks(b))) },
    { label: 'Remove all breaks', action: () => ed.commit((b) => (b.events.breaks = [])) },
  ];

  const web: Item[] = cloud.available
    ? cloud.user
      ? [
          { label: `Logged in as ${cloud.user.username}`, disabled: true },
          { label: 'Save & sync now', action: () => void ed.save() },
          { label: 'Log out', action: () => void cloud.logout() },
        ]
      : [{ label: cloud.oauthConfigured ? 'Log in with osu!' : 'osu! login not configured on server', disabled: !cloud.oauthConfigured, action: async () => { await ed.flushAutosave(); cloud.login(); } }]
    : [{ label: 'Offline mode (no server)', disabled: true }];

  const screens: { s: Screen; label: string }[] = [
    { s: 'compose', label: 'Compose' },
    { s: 'design', label: 'Design' },
    { s: 'timing', label: 'Timing' },
  ];

  return (
    <div className="menubar">
      <Menu title="File" items={file} />
      <Menu title="Edit" items={edit} />
      <Menu title="View" items={view} />
      <Menu title="Compose" items={compose} />
      <Menu title="Timing" items={timing} />
      <Menu title="Web" items={web} />
      <div className="menubar-title" title={projectTitle(ed.project!)}>
        {projectTitle(ed.project!)} <b>[{bm.metadata.version}]</b>
        {ed.dirty && <span className="dirty">●</span>}
      </div>
      <div className="screen-tabs">
        {screens.map(({ s, label }) => (
          <button key={s} className={ed.screen === s ? 'active' : ''} onClick={() => ed.setScreen(s)}>
            {label}
          </button>
        ))}
        <button onClick={() => ed.openDialog('setup')}>Song Setup</button>
      </div>
    </div>
  );
}

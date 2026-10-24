import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCloud } from '../../App';
import { music } from '../../audio/music';
import { serializeBeatmap } from '../../osu/serializer';
import { cloud } from '../../project/cloud';
import { downloadBlob, downloadText, exportOsz, osuFilename, oszFilename } from '../../project/project';
import { confirmBox, inputBox } from '../../ui/prompt';
import { autoBreaks } from '../breaks';
import { DIVISORS } from '../shortcuts';
import { editor, GRID_SIZES, useEditor } from '../store';
import { onMenuChange, openMenu, setOpenMenu } from './menuState';

interface Item {
  label: string;
  shortcut?: string;
  action?: () => void;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  submenu?: Item[];
}

const sep: Item = { label: '', separator: true };

function useOpenMenu() {
  return useSyncExternalStore(onMenuChange, openMenu);
}

function MenuList({ items, onDone, sub }: { items: Item[]; onDone: () => void; sub?: boolean }) {
  const [hoverSub, setHoverSub] = useState<number | null>(null);
  return (
    <div className={`wm-list ${sub ? 'sub' : ''}`}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="wm-sep" />
        ) : (
          <div
            key={i}
            className={`wm-item ${it.disabled ? 'disabled' : ''} ${hoverSub === i ? 'hot' : ''}`}
            onMouseEnter={() => setHoverSub(it.submenu ? i : null)}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disabled || it.submenu) return;
              onDone();
              it.action?.();
            }}
          >
            <span className="wm-check">{it.checked ? '✓' : ''}</span>
            <span className="wm-label">{it.label}</span>
            <span className="wm-shortcut">{it.shortcut ?? ''}</span>
            <span className="wm-arrow">{it.submenu ? '▸' : ''}</span>
            {it.submenu && hoverSub === i && !it.disabled && <MenuList items={it.submenu} onDone={onDone} sub />}
          </div>
        ),
      )}
    </div>
  );
}

function Menu({ title, items }: { title: string; items: Item[] }) {
  const open = useOpenMenu() === title;
  const anyOpen = useOpenMenu() !== null;
  return (
    <div className="wm-menu">
      <button
        className={`wm-title ${open ? 'open' : ''}`}
        onMouseDown={(e) => {
          e.stopPropagation();
          setOpenMenu(open ? null : title);
        }}
        onMouseEnter={() => anyOpen && setOpenMenu(title)}
      >
        {title}
      </button>
      {open && <MenuList items={items} onDone={() => setOpenMenu(null)} />}
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function MenuBar() {
  const ed = useEditor();
  useCloud();
  const ref = useRef<HTMLDivElement>(null);
  const bm = ed.bm;
  const p = ed.prefs;
  const hasSel = ed.selection.size > 0;
  const mode = bm.general.mode;
  const setId = bm.metadata.beatmapSetId;

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpenMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  const exportPackage = async () => downloadBlob(await exportOsz(ed.project!), oszFilename(ed.project!));

  const file: Item[] = [
    { label: 'Clear All Notes', shortcut: 'Ctrl+N', action: () => void ed.clearAllNotes() },
    {
      label: 'Open Difficulty...',
      submenu: [
        {
          label: 'For Editing',
          submenu: ed.project!.difficulties.map((d, i) => ({
            label: `${d.beatmap.metadata.version || '(unnamed)'}${['', ' (osu!taiko)', ' (osu!catch)', ' (osu!mania)'][d.beatmap.general.mode]}`,
            checked: i === ed.diffIndex,
            action: () => void ed.requestSwitchDifficulty(d.id),
          })),
        },
      ],
    },
    { label: 'Save', shortcut: 'Ctrl+S', action: () => void ed.save() },
    { label: 'Create a new Difficulty...', action: () => void ed.beginNewDifficulty() },
    sep,
    { label: 'Revert to Saved', shortcut: 'Ctrl+L', action: () => ed.revertToSaved() },
    { label: 'Revert to Saved (Full)', shortcut: 'Ctrl+Shift+L', action: () => void ed.revertToSavedFull() },
    sep,
    { label: 'Test Beatmap', shortcut: 'F5', action: () => { music.pause(); ed.openDialog('test'); } },
    { label: 'Open AiMod', shortcut: 'Ctrl+Shift+A', action: () => ed.openDialog('aimod') },
    sep,
    { label: 'Export Package...', action: () => void exportPackage() },
    { label: 'Export Difficulty (.osu)...', action: () => downloadText(serializeBeatmap(bm), osuFilename(bm)) },
    sep,
    { label: 'Open Song Folder', action: () => ed.openDialog('export') },
    { label: 'Open .osu in Notepad', action: () => ed.openDialog('osuText') },
    { label: 'Open .osb in Notepad', action: () => ed.openDialog('osbText') },
    sep,
    { label: 'Exit...', shortcut: 'Esc', action: () => void ed.exitEditor() },
  ];

  const edit: Item[] = [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: () => ed.undo(), disabled: !ed.canUndo },
    { label: 'Redo', shortcut: 'Ctrl+Y', action: () => ed.redo(), disabled: !ed.canRedo },
    sep,
    { label: 'Cut', shortcut: 'Ctrl+X', action: () => ed.copy(true), disabled: !hasSel },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => ed.copy(), disabled: !hasSel },
    { label: 'Paste', shortcut: 'Ctrl+V', action: () => ed.paste() },
    { label: 'Delete', shortcut: 'Del', action: () => ed.deleteSelection(), disabled: !hasSel },
    sep,
    { label: 'Select All', shortcut: 'Ctrl+A', action: () => ed.selectAll() },
    { label: 'Clone', shortcut: 'Ctrl+D', action: () => ed.cloneSelection(), disabled: !hasSel },
    sep,
    { label: 'Reverse Selection', shortcut: 'Ctrl+G', action: () => ed.reverseSelection(), disabled: !hasSel },
    { label: 'Flip Horizontally', shortcut: 'Ctrl+H', action: () => ed.flip(true), disabled: !hasSel },
    { label: 'Flip Vertically', shortcut: 'Ctrl+J', action: () => ed.flip(false), disabled: !hasSel },
    { label: 'Rotate 90° Clockwise', shortcut: 'Ctrl+>', action: () => ed.rotate(90, 'playfield'), disabled: !hasSel },
    { label: 'Rotate 90° Anticlockwise', shortcut: 'Ctrl+<', action: () => ed.rotate(-90, 'playfield'), disabled: !hasSel },
    { label: 'Rotate by...', shortcut: 'Ctrl+Shift+R', action: () => ed.openDialog('rotate'), disabled: !hasSel },
    { label: 'Scale by...', shortcut: 'Ctrl+Shift+S', action: () => ed.openDialog('scale'), disabled: !hasSel },
    sep,
    { label: "Reset selected objects' samples", action: () => ed.resetSamples(false), disabled: !hasSel },
    { label: 'Reset all samples', action: async () => (await confirmBox('osu!', 'Reset the hitsounds and sample sets of every object?')) && ed.resetSamples(true) },
    { label: 'Reset combo colours', action: () => ed.resetComboColours() },
    { label: 'Reset breaks', action: () => ed.resetBreaks(autoBreaks(bm)) },
    { label: 'Sample volume and colour skip...', action: () => ed.openDialog('objectSettings'), disabled: !hasSel },
    sep,
    { label: 'Nudge Backward', shortcut: 'J', action: () => ed.nudgeTime(-1), disabled: !hasSel },
    { label: 'Nudge Forward', shortcut: 'K', action: () => ed.nudgeTime(1), disabled: !hasSel },
  ];

  const dims = [0, 0.3, 0.5, 0.7, 0.8, 1];
  const view: Item[] = [
    { label: 'Compose', shortcut: 'F1', action: () => ed.setScreen('compose'), checked: ed.screen === 'compose' },
    { label: 'Design', shortcut: 'F2', action: () => ed.setScreen('design'), checked: ed.screen === 'design' },
    { label: 'Timing', shortcut: 'F3', action: () => ed.setScreen('timing'), checked: ed.screen === 'timing' },
    { label: 'Song Setup...', shortcut: 'F4', action: () => ed.openDialog('setup') },
    { label: 'Timing Setup...', shortcut: 'F6', action: () => ed.openDialog('timingPoints') },
    sep,
    { label: 'Volume...', action: () => ed.openDialog('preferences') },
    {
      label: 'Grid Level',
      shortcut: 'G',
      disabled: mode !== 0,
      submenu: GRID_SIZES.map((g, i) => ({ label: ['Tiny', 'Small', 'Medium', 'Large'][i], shortcut: `Ctrl+${i + 1}`, checked: ed.gridSize === g, action: () => ed.setGridSize(g) })),
    },
    { label: 'Show Video/Storyboard', checked: p.showStoryboard && p.showVideo, action: () => { const on = !(p.showStoryboard && p.showVideo); ed.setPrefs({ showStoryboard: on, showVideo: on }); } },
    { label: 'Dim Background', submenu: dims.map((d) => ({ label: pct(d), checked: Math.abs(p.backgroundDim - d) < 0.01, action: () => ed.setPrefs({ backgroundDim: d }) })) },
    sep,
    { label: 'Snaking sliders', checked: p.snakingSliders, action: () => ed.setPrefs({ snakingSliders: !p.snakingSliders }) },
    { label: 'Hit animations', checked: p.showHitAnimations, action: () => ed.setPrefs({ showHitAnimations: !p.showHitAnimations }) },
    { label: 'Follow points', checked: p.showFollowPoints, action: () => ed.setPrefs({ showFollowPoints: !p.showFollowPoints }) },
    { label: 'Timeline waveform', checked: p.showWaveform, action: () => ed.setPrefs({ showWaveform: !p.showWaveform }) },
    sep,
    { label: 'Options...', action: () => ed.openDialog('preferences') },
  ];

  const compose: Item[] = [
    { label: 'Snap Divisor', submenu: DIVISORS.map((d) => ({ label: `1/${d}`, checked: ed.beatDivisor === d, action: () => ed.setBeatDivisor(d) })) },
    { label: 'Audio Rate', submenu: [0.25, 0.5, 0.75, 1].map((r) => ({ label: pct(r), checked: Math.abs(music.rate - r) < 0.001, action: () => ed.setPlaybackRate(r) })) },
    { label: 'Grid Snapping', shortcut: 'T', checked: ed.gridSnap, disabled: mode !== 0, action: () => { ed.gridSnap = !ed.gridSnap; ed.emit(); } },
    sep,
    { label: 'Create Polygon Circles...', shortcut: 'Ctrl+Shift+D', action: () => ed.openDialog('polygon'), disabled: mode !== 0 },
    { label: 'Convert slider to stream...', shortcut: 'Ctrl+Shift+F', action: () => ed.openDialog('stream'), disabled: !ed.selectedObjects.some((o) => o.kind === 'slider') },
  ];

  const design: Item[] = [
    {
      label: 'Move all elements in time...',
      action: async () => {
        const v = await inputBox('Move all elements in time', 'Move every storyboard command by this many milliseconds:', '0');
        const ms = Math.round(Number(v?.replace(',', '.')));
        if (v !== null && Number.isFinite(ms) && ms) {
          const { design: d } = await import('../storyboard/design');
          d.shiftAllInTime(ms);
        }
      },
    },
  ];

  const red = bm.timingPoints.some((t) => t.uninherited);
  const timing: Item[] = [
    { label: 'Time Signature', disabled: !red, submenu: [4, 3].map((m) => ({ label: `${m}/4`, checked: currentMeter() === m, action: () => ed.setTimeSignature(m) })) },
    { label: 'Metronome Clicks', checked: ed.metronome, action: () => { ed.metronome = !ed.metronome; ed.emit(); } },
    sep,
    { label: 'Add Timing Section', shortcut: 'Ctrl+P', action: () => ed.addTimingSection(true) },
    { label: 'Add Inheriting Section', shortcut: 'Ctrl+Shift+P', action: () => ed.addTimingSection(false) },
    { label: 'Delete Timing Section', shortcut: 'Ctrl+I', action: () => ed.deleteTimingSection() },
    { label: 'Resnap Current Section', action: () => ed.resnapCurrentSection() },
    sep,
    { label: 'Timing Setup...', shortcut: 'F6', action: () => ed.openDialog('timingPoints') },
    sep,
    { label: 'Resnap All Notes', action: () => ed.resnapObjects(true) },
    {
      label: 'Move all notes in time...',
      action: async () => {
        const v = await inputBox('Move all notes in time', 'Move every hit object by this many milliseconds:', '0');
        const ms = Math.round(Number(v?.replace(',', '.')));
        if (v !== null && Number.isFinite(ms)) ed.moveAllNotes(ms);
      },
    },
    { label: 'Recalculate Slider Lengths', action: () => ed.recalculateSliderLengths() },
    { label: 'Delete All Timing Sections', action: async () => (await confirmBox('osu!', 'Delete every timing section (red and green lines)?')) && ed.commit((b) => (b.timingPoints = [])) },
    sep,
    { label: 'Set Current Position as Preview Point', action: () => ed.commit((b) => (b.general.previewTime = Math.round(music.time))) },
    sep,
    { label: 'Add Bookmark', shortcut: 'Ctrl+B', action: () => ed.addBookmark() },
    { label: 'Remove Bookmark', shortcut: 'Ctrl+Shift+B', action: () => ed.removeBookmark() },
  ];

  const open = (url: string) => window.open(url, '_blank', 'noopener');
  const web: Item[] = [
    { label: "This Beatmap's Information Page", disabled: setId <= 0, action: () => open(`https://osu.ppy.sh/beatmapsets/${setId}`) },
    { label: "This Beatmap's Thread", disabled: setId <= 0, action: () => open(`https://osu.ppy.sh/beatmapsets/${setId}/discussion`) },
    sep,
    ...(cloud.available
      ? cloud.user
        ? [
            { label: `Logged in as ${cloud.user.username}`, disabled: true },
            { label: 'Save and sync now', shortcut: 'Ctrl+S', action: () => void ed.save() },
            { label: 'Log out', action: () => void cloud.logout() },
          ]
        : [{ label: cloud.oauthConfigured ? 'Log in with osu!...' : 'osu! login is not configured on this server', disabled: !cloud.oauthConfigured, action: async () => { if (await ed.resolveUnsaved('logging in')) cloud.login(); } }]
      : [{ label: 'Offline: maps are saved in this browser', disabled: true }]),
  ];

  const help: Item[] = [
    { label: 'Show in-game help', action: () => ed.openDialog('shortcuts') },
    { label: 'View FAQ...', action: () => open('https://osu.ppy.sh/wiki/Client/Beatmap_editor') },
  ];

  return (
    <div className="wm-bar" ref={ref}>
      <Menu title="File" items={file} />
      <Menu title="Edit" items={edit} />
      <Menu title="View" items={view} />
      <Menu title="Compose" items={compose} />
      <Menu title="Design" items={design} />
      <Menu title="Timing" items={timing} />
      <Menu title="Web" items={web} />
      <Menu title="Help" items={help} />
      <div className="wm-caption" title="Unsaved changes are marked with *">
        {bm.metadata.artist} - {bm.metadata.title} ({bm.metadata.creator}) [{bm.metadata.version}]{ed.dirty ? ' *' : ''}
      </div>
    </div>
  );
}

function currentMeter(): number {
  const bm = editor.bm;
  let meter = 4;
  for (const tp of bm.timingPoints) {
    if (tp.time > music.time + 0.5) break;
    if (tp.uninherited) meter = tp.meter;
  }
  return meter;
}

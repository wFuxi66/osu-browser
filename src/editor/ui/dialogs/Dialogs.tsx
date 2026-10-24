import { useMemo, useState } from 'react';
import { music } from '../../../audio/music';
import { OkCancel, WinDialog, WinTabs } from '../../../ui/win';
import { runAiMod } from '../../aimod';
import { editor, formatTimestamp, useEditor } from '../../store';
import { TestPlay } from '../TestPlay';
import { SetupDialog } from './SetupDialog';
import { TimingSetupDialog } from './TimingSetupDialog';
import {
  DifficultiesDialog,
  FilesDialog,
  NotepadDialog,
  ObjectSettingsDialog,
  PolygonDialog,
  PreferencesDialog,
  RotateDialog,
  ScaleDialog,
  StreamDialog,
} from './ToolDialogs';

export function Dialogs() {
  const ed = useEditor();
  switch (ed.dialog) {
    case 'setup': return <SetupDialog key={ed.pendingNewDifficulty ? 'new' : ed.diffIndex} />;
    case 'timingPoints': return <TimingSetupDialog />;
    case 'rotate': return <RotateDialog />;
    case 'scale': return <ScaleDialog />;
    case 'polygon': return <PolygonDialog />;
    case 'stream': return <StreamDialog />;
    case 'aimod': return <AiModDialog />;
    case 'difficulties': return <DifficultiesDialog />;
    case 'preferences': return <PreferencesDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'export': return <FilesDialog />;
    case 'osuText': return <NotepadDialog kind="osu" />;
    case 'osbText': return <NotepadDialog kind="osb" />;
    case 'objectSettings': return <ObjectSettingsDialog />;
    case 'test': return <TestPlay />;
    default: return null;
  }
}

const AIMOD_TABS = ['All', 'Problems', 'Warnings', 'Notes'] as const;

function AiModDialog() {
  const ed = useEditor();
  const [tab, setTab] = useState<(typeof AIMOD_TABS)[number]>('All');
  const issues = useMemo(() => runAiMod(ed.project!, ed.bm), [ed.contentRev, ed.diffIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = issues.filter((i) => tab === 'All' || { Problems: 'error', Warnings: 'warning', Notes: 'info' }[tab] === i.severity);
  const close = () => ed.openDialog(null);
  return (
    <WinDialog title="AiMod" width={640} onClose={close} footer={<OkCancel okLabel="Close" onOk={close} onCancel={close} />}>
      <WinTabs tabs={AIMOD_TABS} value={tab} onChange={setTab}>
        <div className="win-list" style={{ height: 320 }}>
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>Category</th><th>Description</th></tr></thead>
            <tbody>
              {shown.map((i, k) => (
                <tr
                  key={k}
                  onDoubleClick={() => {
                    if (i.time !== undefined) music.seek(i.time);
                    if (i.objectIds) editor.select(i.objectIds);
                  }}
                >
                  <td className="win-mono">{i.time !== undefined ? formatTimestamp(i.time) : ''}</td>
                  <td style={{ color: i.severity === 'error' ? '#c00' : i.severity === 'warning' ? '#b07000' : '#06c' }}>{{ error: 'Problem', warning: 'Warning', info: 'Note' }[i.severity]}</td>
                  <td>{i.category}</td>
                  <td style={{ whiteSpace: 'normal' }}>{i.message}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={4}>No problems found.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="win-muted">Double click an entry to jump to it.</p>
      </WinTabs>
    </WinDialog>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['General', [
    ['Z / V', 'Jump to first / last note'], ['X', 'Play from start'], ['C or Space', 'Pause / resume'],
    ['← / →', 'Seek by beat snap'], ['Shift + ← / →', 'Seek 4x'], ['↑ / ↓', 'Next / previous timing point'],
    ['Ctrl + B / Ctrl + Shift + B', 'Add / remove bookmark'], ['Ctrl + ← / →', 'Previous / next bookmark (no selection)'],
    ['Ctrl + S', 'Save (nothing saves automatically)'], ['Ctrl + L / Ctrl + Shift + L', 'Revert to saved / full revert'], ['Ctrl + O', 'Open difficulty'],
    ['Ctrl + N', 'Clear all notes (or File menu; some browsers keep Ctrl+N)'], ['Esc', 'Back to song select (asks to save)'],
    ['Ctrl + ↑ / ↓', 'Playback speed ±25% (no selection)'], ['Ctrl + Shift + ↑ / ↓', 'Playback speed ±5%'],
    ['F1 / F2 / F3', 'Compose / Design / Timing'], ['F4', 'Song Setup'], ['F5', 'Test mode'], ['F6', 'Timing Setup'],
    ['Ctrl + P / Ctrl + Shift + P', 'Add timing / inheriting section'], ['Ctrl + I', 'Delete timing section'],
  ]],
  ['Mouse', [
    ['Wheel', 'Seek'], ['Shift + Wheel', 'Seek 4x'], ['Ctrl + Wheel', 'Beat snap divisor'],
    ['Alt + Wheel', 'Distance snap (playfield) / zoom (timeline)'], ['Alt + Shift + Wheel', 'Distance snap, fine'], ['Ctrl + Alt + Wheel', 'Switch tool'],
    ['Double click', 'Jump to object / slider end'], ['Right click', 'Delete (select tool) / new combo or finish (placing)'],
  ]],
  ['Compose', [
    ['1 2 3 4', 'Select / circle / slider / spinner'], ['Ctrl + Z / Y', 'Undo / redo'], ['Ctrl + A X C V D', 'Select all / cut / copy / paste / clone'],
    ['Delete', 'Delete selection'], ['Ctrl + Shift + A', 'AiMod'], ['Enter', 'Finish slider'],
    ['T / Y', 'Grid snap / distance snap'], ['Shift (hold) / Alt (hold)', 'Toggle grid / distance snap temporarily'],
    ['G', 'Cycle grid size'], ['Ctrl + 1–4', 'Grid size'], ['L', 'Lock notes'], ['Q', 'New combo'],
    ['Ctrl + < / >', 'Rotate 90°'], ['Ctrl + H / J', 'Flip horizontally / vertically'], ['Ctrl + G', 'Reverse selection'],
    ['Ctrl + Shift + R / S', 'Rotate by / scale by'], ['Ctrl + Shift + D', 'Polygon circles'], ['Ctrl + Shift + F', 'Slider to stream'],
    ['Ctrl + arrows', 'Nudge selection'], ['J / K', 'Nudge by one beat snap'],
  ]],
  ['Hitsounds', [
    ['W / E / R', 'Whistle / finish / clap'], ['Shift + Q W E R', 'Sampleset auto / normal / soft / drum'],
    ['Ctrl (or Alt) + Q W E R', 'Addition set auto / normal / soft / drum'], ['Shift + 1–9', 'Beat snap divisor 1/1 – 1/9'],
  ]],
  ['Timing', [['T', 'Tap tempo'], ['Shift / Ctrl on ‹ ›', '5x / fine steps']]],
];

function ShortcutsDialog() {
  const close = () => editor.openDialog(null);
  return (
    <WinDialog title="osu! editor help" width={760} onClose={close} footer={<OkCancel okLabel="Close" onOk={close} onCancel={close} />}>
      <p className="win-muted">Letter keys follow your keyboard layout (on AZERTY, W is the key labelled W). Browsers keep Ctrl+W and sometimes Ctrl+N for themselves; Alt+W sets the normal addition set.</p>
      <div className="help-grid">
        {SHORTCUTS.map(([group, list]) => (
          <div key={group} className="win-group">
            <b>{group}</b>
            <table>
              <tbody>
                {list.map(([k, v]) => (
                  <tr key={k}>
                    <td className="help-key">{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </WinDialog>
  );
}

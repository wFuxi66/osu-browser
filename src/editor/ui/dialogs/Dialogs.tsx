import { useMemo, useState } from 'react';
import { music } from '../../../audio/music';
import { OkCancel, WinDialog, WinTabs } from '../../../ui/win';
import { runAiMod } from '../../aimod';
import { ACTIONS, keyLabel, keysFor, type Keybinds } from '../../keybinds';
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

// What the key bindings (Options → Input) can't show: the mouse, and keys that act while held.
const OTHER_CONTROLS: [string, [string, string][]][] = [
  ['Mouse', [
    ['Wheel', 'Seek'], ['Shift + Wheel', 'Seek 4x'], ['Ctrl + Wheel', 'Beat snap divisor'],
    ['Alt + Wheel', 'Distance snap (playfield) / zoom (timeline)'], ['Alt + Shift + Wheel', 'Distance snap, fine'], ['Ctrl + Alt + Wheel', 'Switch tool'],
    ['Double click', 'Jump to object / slider end'], ['Right click', 'Delete (select tool) / new combo or finish (placing)'],
  ]],
  ['Held keys', [
    ['Shift (hold)', 'Toggle grid snap while placing'], ['Alt (hold)', 'Toggle distance snap while placing'], ['Esc', 'Cancel, or back to song select (asks to save)'],
    ['T (Timing screen)', 'Tap tempo'], ['Shift / Ctrl on ‹ ›', '5x / fine steps'],
  ]],
];

function ShortcutsDialog() {
  const close = () => editor.openDialog(null);
  return (
    <WinDialog title="osu! editor help" width={760} onClose={close} footer={<OkCancel okLabel="Close" onOk={close} onCancel={close} />}>
      <p className="win-muted">
        Letter keys follow your keyboard layout (on AZERTY, W is the key labelled W). Browsers keep Ctrl+W and sometimes Ctrl+N for themselves;
        Alt+W sets the normal addition set. Change any key in Options → Input.
      </p>
      <div className="help-grid">
        {[...bindingGroups(editor.prefs.keybinds), ...OTHER_CONTROLS].map(([group, list]) => (
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

/** The keyboard shortcuts as currently bound, by group. */
function bindingGroups(binds: Keybinds): [string, [string, string][]][] {
  const groups = new Map<string, [string, string][]>();
  for (const x of ACTIONS) {
    const keys = keysFor(x.id, binds);
    if (!groups.has(x.group)) groups.set(x.group, []);
    groups.get(x.group)!.push([keys.length ? keys.map(keyLabel).join(' or ') : '(none)', x.label]);
  }
  return [...groups];
}

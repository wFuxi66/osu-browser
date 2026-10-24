import { useMemo } from 'react';
import { music } from '../../../audio/music';
import { runAiMod } from '../../aimod';
import { editor, formatTimestamp, useEditor } from '../../store';
import { TestPlay } from '../TestPlay';
import { TimingPointsTable } from '../TimingPointsTable';
import { Modal } from './Modal';
import { SetupDialog } from './SetupDialog';
import {
  DifficultiesDialog,
  FilesDialog,
  NewDifficultyDialog,
  PolygonDialog,
  PreferencesDialog,
  RotateDialog,
  ScaleDialog,
  StreamDialog,
} from './ToolDialogs';

export function Dialogs() {
  const ed = useEditor();
  switch (ed.dialog) {
    case 'setup': return <SetupDialog />;
    case 'timingPoints':
      return (
        <Modal title="Timing and Control Points" wide footer={<button className="primary" onClick={() => ed.openDialog(null)}>Done</button>}>
          <TimingPointsTable />
        </Modal>
      );
    case 'rotate': return <RotateDialog />;
    case 'scale': return <ScaleDialog />;
    case 'polygon': return <PolygonDialog />;
    case 'stream': return <StreamDialog />;
    case 'aimod': return <AiModDialog />;
    case 'difficulties': return <DifficultiesDialog />;
    case 'newDifficulty': return <NewDifficultyDialog />;
    case 'preferences': return <PreferencesDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'export': return <FilesDialog />;
    case 'test': return <TestPlay />;
    default: return null;
  }
}

function AiModDialog() {
  const ed = useEditor();
  const issues = useMemo(() => runAiMod(ed.project!, ed.bm), [ed.contentRev, ed.diffIndex]);
  const counts = { error: 0, warning: 0, info: 0 };
  issues.forEach((i) => counts[i.severity]++);
  return (
    <Modal title="AiMod" wide footer={<button className="primary" onClick={() => ed.openDialog(null)}>Close</button>}>
      <p>
        <span className="sev error">{counts.error} problems</span> <span className="sev warning">{counts.warning} warnings</span> <span className="sev info">{counts.info} notes</span>
      </p>
      {issues.length === 0 && <p>No issues found. 🎉</p>}
      <ul className="aimod-list">
        {issues.map((i, k) => (
          <li key={k} className={i.severity}>
            <span className="cat">{i.category}</span>
            {i.time !== undefined ? (
              <button
                className="link"
                onClick={() => {
                  music.seek(i.time!);
                  if (i.objectIds) editor.select(i.objectIds);
                }}
              >
                {formatTimestamp(i.time)}
              </button>
            ) : (
              <span className="muted">—</span>
            )}
            <span>{i.message}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['General', [
    ['Z / V', 'Jump to first / last note'], ['X', 'Play from start'], ['C or Space', 'Pause / resume'],
    ['← / →', 'Seek by beat snap'], ['Shift + ← / →', 'Seek 4x'], ['↑ / ↓', 'Next / previous timing point'],
    ['Ctrl + B / Ctrl + Shift + B', 'Add / remove bookmark'], ['Ctrl + ← / →', 'Previous / next bookmark (no selection)'],
    ['Ctrl + S', 'Save'], ['Ctrl + L', 'Revert to saved'], ['Ctrl + O', 'Difficulties'], ['Ctrl + N', 'Remove all objects'],
    ['Ctrl + ↑ / ↓', 'Playback speed ±25% (no selection)'], ['Ctrl + Shift + ↑ / ↓', 'Playback speed ±5%'],
    ['F1 / F2 / F3', 'Compose / Design / Timing'], ['F4', 'Song setup'], ['F5', 'Test mode'], ['F6', 'Timing points'],
    ['Ctrl + P / Ctrl + Shift + P', 'Add red / green line'], ['Ctrl + I', 'Delete current timing point'],
  ]],
  ['Mouse', [
    ['Wheel', 'Seek'], ['Shift + Wheel', 'Seek 4x'], ['Ctrl + Wheel', 'Beat snap divisor'],
    ['Alt + Wheel', 'Distance spacing (playfield) / zoom (timeline)'], ['Ctrl + Alt + Wheel', 'Switch tool'],
    ['Double click', 'Jump to object'], ['Right click', 'Delete object (select) / toggle new combo (placing) / finish slider'],
  ]],
  ['Compose', [
    ['1 2 3 4', 'Select / circle / slider / spinner'], ['Ctrl + Z / Y', 'Undo / redo'], ['Ctrl + A X C V D', 'Select all / cut / copy / paste / clone'],
    ['Delete', 'Delete selection'], ['Ctrl + Shift + A', 'AiMod'], ['Esc', 'Cancel placement / clear selection'], ['Enter', 'Finish slider'],
    ['T / Y', 'Toggle grid / distance snap'], ['Shift (hold) / Alt (hold)', 'Temporarily toggle grid / distance snap'],
    ['G', 'Cycle grid size'], ['Ctrl + 1-4', 'Grid size'], ['L', 'Lock notes'],
    ['Q', 'New combo'], ['Ctrl + , / .', 'Rotate 90°'], ['Ctrl + H / J', 'Flip horizontal / vertical'], ['Ctrl + G', 'Reverse selection'],
    ['Ctrl + Shift + R / S', 'Rotate / scale by…'], ['Ctrl + Shift + D', 'Polygon circles'], ['Ctrl + Shift + F', 'Slider to stream'],
    ['Ctrl + arrows', 'Nudge selection by 1px'], ['J / K', 'Nudge selection by one beat snap'],
  ]],
  ['Sliders', [
    ['Click', 'Add point while placing'], ['Click the last point again', 'Make it a red anchor'], ['Right click / Enter', 'Finish slider'],
    ['Drag a control point', 'Move it (selected slider)'], ['Ctrl + click on a point', 'Toggle red anchor'], ['Ctrl + click on the body', 'Insert a point'],
    ['Right click a point', 'Delete it'], ['Drag the tail in the timeline', 'Add / remove repeats'],
  ]],
  ['Hitsounding', [
    ['W / E / R', 'Whistle / finish / clap'], ['Shift + Q W E R', 'Sampleset auto / normal / soft / drum'],
    ['Ctrl (or Alt) + Q W E R', 'Addition set auto / normal / soft / drum'], ['Click a slider edge in the timeline', 'Hitsound one edge'],
    ['Shift + 1-9', 'Beat snap divisor 1/1 – 1/9'],
  ]],
  ['Timing', [['T', 'Tap tempo (timing screen)'], ['Shift / Ctrl on +/−', '×5 / fine adjust']]],
];

function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" wide>
      <p className="muted">Browsers reserve Ctrl+W and Ctrl+N; use Alt+W for the normal addition set. Ctrl+N is available from the Edit menu.</p>
      <div className="shortcut-grid">
        {SHORTCUTS.map(([group, list]) => (
          <div key={group}>
            <h3>{group}</h3>
            <table>
              <tbody>
                {list.map(([k, v]) => (
                  <tr key={k}>
                    <td><kbd>{k}</kbd></td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Modal>
  );
}

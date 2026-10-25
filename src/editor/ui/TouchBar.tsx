import { useState } from 'react';
import { runAction } from '../shortcuts';
import { useEditor } from '../store';
import { touchMods, useTouch, useTouchMods, type TouchMods } from '../../ui/touch';

const MAIN: [string, string][] = [
  ['undo', 'Undo'],
  ['redo', 'Redo'],
  ['copy', 'Copy'],
  ['paste', 'Paste'],
  ['cut', 'Cut'],
  ['delete', 'Delete'],
  ['selectAll', 'All'],
];

const MORE: [string, string][] = [
  ['clone', 'Clone'],
  ['reverse', 'Reverse'],
  ['flipH', 'Flip H'],
  ['flipV', 'Flip V'],
  ['rotateCw', 'Rot +90°'],
  ['rotateCcw', 'Rot −90°'],
  ['rotateBy', 'Rotate…'],
  ['scaleBy', 'Scale…'],
  ['polygon', 'Polygon…'],
  ['stream', 'Stream…'],
  ['addBookmark', '+ Bookmark'],
  ['removeBookmark', '− Bookmark'],
  ['seekFirst', '⏮ First'],
  ['seekLast', 'Last ⏭'],
];

const MODS: [keyof TouchMods, string][] = [
  ['shift', 'Shift'],
  ['ctrl', 'Ctrl'],
  ['alt', 'Alt'],
];

/** On touch screens, buttons for what the keyboard does on desktop: editing actions and held modifiers. */
export function TouchBar() {
  const ed = useEditor();
  const touch = useTouch();
  const mods = useTouchMods();
  const [open, setOpen] = useState(true);
  const [more, setMore] = useState(false);
  if (!touch) return null;
  const btn = (action: string, label: string, close = false) => (
    <button
      key={action}
      onClick={() => {
        runAction(action);
        if (close) setMore(false);
      }}
    >
      {label}
    </button>
  );
  return (
    <div className={`ed-touchbar ${open ? '' : 'closed'}`}>
      <button className="ed-touchbar-fold" onClick={() => setOpen(!open)} title={open ? 'Hide' : 'Touch tools'}>
        {open ? '‹' : '›'}
      </button>
      {open && (
        <div className="ed-touchbar-grid">
          {ed.placing && (
            <button className="wide accent" onClick={() => (ed.placing?.kind === 'spinner' ? ed.spinnerClick() : runAction('finishPlacing'))}>
              Finish
            </button>
          )}
          {MAIN.map(([a, l]) => btn(a, l))}
          <button className={more ? 'on' : ''} onClick={() => setMore(!more)}>
            More
          </button>
          {MODS.map(([k, l]) => (
            <button key={k} className={mods[k] ? 'on' : ''} onClick={() => touchMods.toggle(k)}>
              {l}
            </button>
          ))}
        </div>
      )}
      {open && more && <div className="ed-touchbar-more">{MORE.map(([a, l]) => btn(a, l, true))}</div>}
    </div>
  );
}

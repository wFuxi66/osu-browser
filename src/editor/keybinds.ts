// Rebindable keyboard shortcuts: every editor action with its default keys (stable's), overridable in Options → Input.
// A key is written as modifiers + a KeyboardEvent.code-style name, e.g. "Ctrl+Shift+KeyS", "F5", "Shift+Digit4".
// Letters follow the keyboard layout (see layoutCode), so "KeyW" is the key labelled W on AZERTY too.

export interface ActionDef {
  id: string;
  label: string;
  group: string;
  keys: string[];
}

const a = (group: string, id: string, label: string, ...keys: string[]): ActionDef => ({ id, label, group, keys });

export const ACTIONS: ActionDef[] = [
  a('Screens', 'compose', 'Compose', 'F1'),
  a('Screens', 'design', 'Design', 'F2'),
  a('Screens', 'timing', 'Timing', 'F3'),
  a('Screens', 'setup', 'Song Setup', 'F4'),
  a('Screens', 'test', 'Test the beatmap', 'F5'),
  a('Screens', 'timingSetup', 'Timing Setup', 'F6'),

  a('File', 'save', 'Save', 'Ctrl+KeyS'),
  a('File', 'revert', 'Revert to saved', 'Ctrl+KeyL'),
  a('File', 'revertFull', 'Revert to saved (full)', 'Ctrl+Shift+KeyL'),
  a('File', 'openDifficulty', 'Open difficulty', 'Ctrl+KeyO'),
  a('File', 'clearAll', 'Clear all notes', 'Ctrl+KeyN'),
  a('File', 'aimod', 'AiMod', 'Ctrl+Shift+KeyA'),

  a('Playback', 'play', 'Play (from the start if playing)', 'KeyX'),
  a('Playback', 'pause', 'Pause / resume', 'KeyC', 'Space'),
  a('Playback', 'seekFirst', 'Jump to the first object', 'KeyZ'),
  a('Playback', 'seekLast', 'Jump to the last object', 'KeyV'),
  a('Playback', 'seekBack', 'Seek back one beat snap', 'ArrowLeft'),
  a('Playback', 'seekForward', 'Seek forward one beat snap', 'ArrowRight'),
  a('Playback', 'seekBack4', 'Seek back 4 beat snaps', 'Shift+ArrowLeft'),
  a('Playback', 'seekForward4', 'Seek forward 4 beat snaps', 'Shift+ArrowRight'),
  a('Playback', 'nextTimingPoint', 'Next timing point', 'ArrowUp'),
  a('Playback', 'prevTimingPoint', 'Previous timing point', 'ArrowDown'),
  a('Playback', 'faster', 'Playback speed +25% (nudge up with a selection)', 'Ctrl+ArrowUp'),
  a('Playback', 'slower', 'Playback speed −25% (nudge down with a selection)', 'Ctrl+ArrowDown'),
  a('Playback', 'fasterFine', 'Playback speed +5%', 'Ctrl+Shift+ArrowUp'),
  a('Playback', 'slowerFine', 'Playback speed −5%', 'Ctrl+Shift+ArrowDown'),

  a('Edit', 'undo', 'Undo', 'Ctrl+KeyZ'),
  a('Edit', 'redo', 'Redo', 'Ctrl+KeyY', 'Ctrl+Shift+KeyZ'),
  a('Edit', 'selectAll', 'Select all', 'Ctrl+KeyA'),
  a('Edit', 'cut', 'Cut', 'Ctrl+KeyX'),
  a('Edit', 'copy', 'Copy', 'Ctrl+KeyC'),
  a('Edit', 'paste', 'Paste', 'Ctrl+KeyV'),
  a('Edit', 'clone', 'Clone', 'Ctrl+KeyD'),
  a('Edit', 'delete', 'Delete', 'Delete', 'Backspace'),
  a('Edit', 'nudgeLeft', 'Move selection left (previous bookmark without one)', 'Ctrl+ArrowLeft'),
  a('Edit', 'nudgeRight', 'Move selection right (next bookmark without one)', 'Ctrl+ArrowRight'),
  a('Edit', 'nudgeBack', 'Nudge selection back one beat snap', 'KeyJ'),
  a('Edit', 'nudgeForward', 'Nudge selection forward one beat snap', 'KeyK'),
  a('Edit', 'flipH', 'Flip horizontally', 'Ctrl+KeyH'),
  a('Edit', 'flipV', 'Flip vertically', 'Ctrl+KeyJ'),
  a('Edit', 'rotateCw', 'Rotate 90° clockwise', 'Ctrl+Period', 'Ctrl+Shift+Period'),
  a('Edit', 'rotateCcw', 'Rotate 90° anticlockwise', 'Ctrl+Comma', 'Ctrl+Shift+Comma'),
  a('Edit', 'reverse', 'Reverse selection', 'Ctrl+KeyG'),
  a('Edit', 'rotateBy', 'Rotate by...', 'Ctrl+Shift+KeyR'),
  a('Edit', 'scaleBy', 'Scale by...', 'Ctrl+Shift+KeyS'),
  a('Edit', 'polygon', 'Create polygon circles...', 'Ctrl+Shift+KeyD'),
  a('Edit', 'stream', 'Convert slider to stream...', 'Ctrl+Shift+KeyF'),

  a('Compose', 'toolSelect', 'Select tool', 'Digit1'),
  a('Compose', 'toolCircle', 'Circle tool', 'Digit2'),
  a('Compose', 'toolSlider', 'Slider tool', 'Digit3'),
  a('Compose', 'toolSpinner', 'Spinner tool', 'Digit4'),
  a('Compose', 'finishPlacing', 'Finish the slider being placed', 'Enter', 'NumpadEnter'),
  a('Compose', 'gridSnap', 'Grid snap', 'KeyT'),
  a('Compose', 'distanceSnap', 'Distance snap', 'KeyY'),
  a('Compose', 'gridCycle', 'Cycle grid size', 'KeyG'),
  a('Compose', 'grid1', 'Grid size: tiny', 'Ctrl+Digit1'),
  a('Compose', 'grid2', 'Grid size: small', 'Ctrl+Digit2'),
  a('Compose', 'grid3', 'Grid size: medium', 'Ctrl+Digit3'),
  a('Compose', 'grid4', 'Grid size: large', 'Ctrl+Digit4'),
  a('Compose', 'lock', 'Lock notes', 'KeyL'),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => a('Compose', `divisor${n}`, `Beat snap divisor 1/${n}`, `Shift+Digit${n}`)),

  a('Hitsounds', 'newCombo', 'New combo', 'KeyQ'),
  a('Hitsounds', 'whistle', 'Whistle', 'KeyW'),
  a('Hitsounds', 'finish', 'Finish', 'KeyE'),
  a('Hitsounds', 'clap', 'Clap', 'KeyR'),
  a('Hitsounds', 'sampleAuto', 'Sampleset: auto', 'Shift+KeyQ'),
  a('Hitsounds', 'sampleNormal', 'Sampleset: normal', 'Shift+KeyW'),
  a('Hitsounds', 'sampleSoft', 'Sampleset: soft', 'Shift+KeyE'),
  a('Hitsounds', 'sampleDrum', 'Sampleset: drum', 'Shift+KeyR'),
  // Browsers keep Ctrl+W (close tab), so Alt+Q–R do the same.
  a('Hitsounds', 'additionAuto', 'Addition set: auto', 'Ctrl+KeyQ', 'Alt+KeyQ'),
  a('Hitsounds', 'additionNormal', 'Addition set: normal', 'Ctrl+KeyW', 'Alt+KeyW'),
  a('Hitsounds', 'additionSoft', 'Addition set: soft', 'Ctrl+KeyE', 'Alt+KeyE'),
  a('Hitsounds', 'additionDrum', 'Addition set: drum', 'Ctrl+KeyR', 'Alt+KeyR'),

  a('Timing', 'addTiming', 'Add timing section', 'Ctrl+KeyP'),
  a('Timing', 'addInherited', 'Add inheriting section', 'Ctrl+Shift+KeyP'),
  a('Timing', 'deleteTiming', 'Delete timing section', 'Ctrl+KeyI'),
  a('Timing', 'addBookmark', 'Add bookmark', 'Ctrl+KeyB'),
  a('Timing', 'removeBookmark', 'Remove bookmark', 'Ctrl+Shift+KeyB'),

  a('Test mode', 'hit1', 'Hit (key 1)', 'KeyZ'),
  a('Test mode', 'hit2', 'Hit (key 2)', 'KeyX'),
];

export type ActionId = string;
/** The user's changes: action id → its keys (an empty list unbinds it). Actions not listed keep their defaults. */
export type Keybinds = Record<ActionId, string[]>;

const BY_ID = new Map(ACTIONS.map((x) => [x.id, x]));

/** Test mode has its own keys, so they don't clash with the editor's. */
export const scopeOf = (id: ActionId) => (BY_ID.get(id)?.group === 'Test mode' ? 'test' : 'editor');

export function keysFor(id: ActionId, binds: Keybinds): string[] {
  return binds[id] ?? BY_ID.get(id)?.keys ?? [];
}

/** The action a key runs in a scope, or undefined. */
export function actionFor(combo: string, binds: Keybinds, scope: 'editor' | 'test' = 'editor'): ActionId | undefined {
  for (const x of ACTIONS) if (scopeOf(x.id) === scope && keysFor(x.id, binds).includes(combo)) return x.id;
  return undefined;
}

/** Other actions in the same scope that already use a key. */
export function conflicts(id: ActionId, combo: string, binds: Keybinds): ActionDef[] {
  return ACTIONS.filter((x) => x.id !== id && scopeOf(x.id) === scopeOf(id) && keysFor(x.id, binds).includes(combo));
}

/**
 * Binds a key to an action (replacing its key at `slot`, or adding one), and takes it away from any other action in
 * the same scope, like osu!'s key binding screen. Returns the new overrides.
 */
export function bind(binds: Keybinds, id: ActionId, combo: string, slot: number): Keybinds {
  const out: Keybinds = { ...binds };
  for (const x of conflicts(id, combo, binds)) out[x.id] = keysFor(x.id, binds).filter((k) => k !== combo);
  const keys = [...keysFor(id, binds)];
  if (slot < keys.length) keys[slot] = combo;
  else keys.push(combo);
  out[id] = [...new Set(keys)];
  return tidy(out);
}

export function unbind(binds: Keybinds, id: ActionId, slot: number): Keybinds {
  return tidy({ ...binds, [id]: keysFor(id, binds).filter((_, i) => i !== slot) });
}

export function resetBinding(binds: Keybinds, id: ActionId): Keybinds {
  const out = { ...binds };
  delete out[id];
  return out;
}

/** Drops overrides that are the same as the defaults, so later default changes still reach the user. */
function tidy(binds: Keybinds): Keybinds {
  const out: Keybinds = {};
  for (const [id, keys] of Object.entries(binds)) {
    const def = BY_ID.get(id);
    if (def && (keys.length !== def.keys.length || keys.some((k, i) => k !== def.keys[i]))) out[id] = keys;
  }
  return out;
}

/** The key combo of a keydown, or null for a lone modifier. `code` is the layout-aware key name (layoutCode). */
export function comboOf(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, code: string): string | null {
  if (/^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code) || code === '') return null;
  return `${e.ctrlKey || e.metaKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${code}`;
}

const NAMES: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Comma: '<',
  Period: '>',
  Delete: 'Del',
  Backspace: 'Backspace',
  Escape: 'Esc',
  NumpadEnter: 'Enter (numpad)',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  Slash: '/',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

/** A key combo as the menus show it, e.g. "Ctrl+Shift+S". */
export function keyLabel(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const name = NAMES[key] ?? key.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, 'Num $1');
  return [...parts, name].join('+');
}

/** The first key of an action, for menus and tooltips ('' when unbound). */
export function shortcutOf(id: ActionId, binds: Keybinds): string {
  const k = keysFor(id, binds)[0];
  return k ? keyLabel(k) : '';
}

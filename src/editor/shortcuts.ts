// Global keyboard + wheel bindings, following the osu! stable editor's defaults.
import { music } from '../audio/music';
import { activePlayfield } from './ui/Playfield';
import { editor, maniaColumn, maniaX, type Tool } from './store';
import { design } from './storyboard/design';
import { optionsOpen } from '../ui/options';
import { promptOpen } from '../ui/prompt';
import { closeMenus } from './ui/menuState';
import { actionFor, comboOf } from './keybinds';

export const DIVISORS = [1, 2, 3, 4, 6, 8, 12, 16];

function isFormField(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isTyping(e: Event): boolean {
  return isFormField(e.target as HTMLElement | null);
}

export function stepDivisor(dir: 1 | -1) {
  const cur = editor.beatDivisor;
  let i = DIVISORS.indexOf(cur);
  if (i < 0) i = DIVISORS.findIndex((d) => d > cur) - (dir > 0 ? 1 : 0);
  editor.setBeatDivisor(DIVISORS[Math.max(0, Math.min(DIVISORS.length - 1, i + dir))]);
}

function setTool(n: number) {
  const tools: Tool[] = editor.bm.general.mode === 3 ? ['select', 'circle', 'slider'] : ['select', 'circle', 'slider', 'spinner'];
  const t = tools[n - 1];
  if (t) editor.setTool(t);
}

function maniaShiftColumns(dir: number) {
  const keys = Math.round(editor.bm.difficulty.circleSize);
  const sel = editor.selectedObjects;
  if (!sel.length) return;
  const cols = sel.map((o) => maniaColumn(o.x, keys) + dir);
  if (cols.some((c) => c < 0 || c >= keys)) return;
  editor.commit(() => sel.forEach((o, i) => (o.x = maniaX(cols[i], keys))));
}

/**
 * Layout-aware key name in KeyboardEvent.code style. Letters follow the character the layout produces, like
 * stable (Windows virtual keys): on AZERTY the key labelled W gives "KeyW", not "KeyZ". Digits and other keys
 * keep their physical position, so the number row works without Shift on AZERTY.
 */
export function layoutCode(e: KeyboardEvent): string {
  if (e.key.length === 1) {
    const k = e.key.toLowerCase();
    if (k >= 'a' && k <= 'z') return `Key${k.toUpperCase()}`;
    if (k === ',' || k === '<') return 'Comma';
    if (k === '.' || k === '>') return 'Period';
  }
  if (/^Digit\d$|^Numpad\d$/.test(e.code)) return e.code.replace('Numpad', 'Digit');
  return e.code;
}

const SCREEN_ACTIONS = new Set(['compose', 'design', 'timing', 'setup', 'test', 'timingSetup']);

/** What each bindable action does in the editor (see keybinds.ts for their keys). */
const RUN: Record<string, () => void> = {
  compose: () => editor.setScreen('compose'),
  design: () => editor.setScreen('design'),
  timing: () => editor.setScreen('timing'),
  setup: () => editor.openDialog('setup'),
  test: () => { music.pause(); editor.openDialog('test'); },
  timingSetup: () => editor.openDialog('timingPoints'),

  save: () => void editor.save(),
  revert: () => editor.revertToSaved(),
  revertFull: () => void editor.revertToSavedFull(),
  openDifficulty: () => editor.openDialog('difficulties'),
  clearAll: () => void editor.clearAllNotes(),
  aimod: () => editor.openDialog('aimod'),

  play: () => { if (music.playing) music.seek(0); void music.play(); },
  pause: () => music.toggle(),
  seekFirst: () => editor.seekFirstObject(),
  seekLast: () => editor.seekLastObject(),
  seekBack: () => editor.seekTick(-1),
  seekForward: () => editor.seekTick(1),
  seekBack4: () => editor.seekTick(-1, 4),
  seekForward4: () => editor.seekTick(1, 4),
  nextTimingPoint: () => editor.seekTimingPoint(1),
  prevTimingPoint: () => editor.seekTimingPoint(-1),
  faster: () => {
    if (!hasSel()) editor.setPlaybackRate(music.rate + 0.25);
    else if (isMania()) editor.nudgeTime(1);
    else editor.nudgePosition(0, -1);
  },
  slower: () => {
    if (!hasSel()) editor.setPlaybackRate(music.rate - 0.25);
    else if (isMania()) editor.nudgeTime(-1);
    else editor.nudgePosition(0, 1);
  },
  fasterFine: () => {
    if (hasSel() && !isMania()) editor.nudgePosition(0, -editor.gridSize);
    else editor.setPlaybackRate(music.rate + 0.05);
  },
  slowerFine: () => {
    if (hasSel() && !isMania()) editor.nudgePosition(0, editor.gridSize);
    else editor.setPlaybackRate(music.rate - 0.05);
  },

  undo: () => editor.undo(),
  redo: () => editor.redo(),
  selectAll: () => editor.selectAll(),
  cut: () => editor.copy(true),
  copy: () => editor.copy(),
  paste: () => editor.paste(),
  clone: () => editor.cloneSelection(),
  delete: () => editor.deleteSelection(),
  nudgeLeft: () => {
    if (!hasSel()) editor.seekBookmark(-1);
    else if (isMania()) maniaShiftColumns(-1);
    else editor.nudgePosition(-1, 0);
  },
  nudgeRight: () => {
    if (!hasSel()) editor.seekBookmark(1);
    else if (isMania()) maniaShiftColumns(1);
    else editor.nudgePosition(1, 0);
  },
  nudgeLeftGrid: () => { if (hasSel() && !isMania()) editor.nudgePosition(-editor.gridSize, 0); },
  nudgeRightGrid: () => { if (hasSel() && !isMania()) editor.nudgePosition(editor.gridSize, 0); },
  nudgeBack: () => editor.nudgeTime(-1),
  nudgeForward: () => editor.nudgeTime(1),
  flipH: () => editor.flip(true),
  flipV: () => editor.flip(false),
  rotateCw: () => editor.rotate(90, 'playfield'),
  rotateCcw: () => editor.rotate(-90, 'playfield'),
  reverse: () => editor.reverseSelection(),
  rotateBy: () => { if (hasSel()) editor.openDialog('rotate'); },
  scaleBy: () => { if (hasSel()) editor.openDialog('scale'); },
  polygon: () => editor.openDialog('polygon'),
  stream: () => { if (hasSel()) editor.openDialog('stream'); },

  toolSelect: () => setTool(1),
  toolCircle: () => setTool(2),
  toolSlider: () => setTool(3),
  toolSpinner: () => setTool(4),
  finishPlacing: () => activePlayfield.current?.commitPlacement?.(),
  gridSnap: () => { editor.gridSnap = !editor.gridSnap; editor.emit(); },
  distanceSnap: () => { editor.distanceSnap = !editor.distanceSnap; editor.emit(); },
  gridCycle: () => editor.cycleGridSize(),
  grid1: () => editor.setGridSize(4),
  grid2: () => editor.setGridSize(8),
  grid3: () => editor.setGridSize(16),
  grid4: () => editor.setGridSize(32),
  lock: () => { editor.locked = !editor.locked; editor.emit(); },
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`divisor${n}`, () => editor.setBeatDivisor(n)])),

  newCombo: () => editor.toggleNewCombo(),
  whistle: () => editor.toggleAddition(2),
  finish: () => editor.toggleAddition(4),
  clap: () => editor.toggleAddition(8),
  sampleAuto: () => editor.setSampleSet('normal', 0),
  sampleNormal: () => editor.setSampleSet('normal', 1),
  sampleSoft: () => editor.setSampleSet('normal', 2),
  sampleDrum: () => editor.setSampleSet('normal', 3),
  additionAuto: () => editor.setSampleSet('addition', 0),
  additionNormal: () => editor.setSampleSet('addition', 1),
  additionSoft: () => editor.setSampleSet('addition', 2),
  additionDrum: () => editor.setSampleSet('addition', 3),

  addTiming: () => editor.addTimingSection(true),
  addInherited: () => editor.addTimingSection(false),
  deleteTiming: () => editor.deleteTimingSection(),
  addBookmark: () => editor.addBookmark(),
  removeBookmark: () => editor.removeBookmark(),
};

/** Runs a bindable action by name, for buttons that stand in for keys (the touch toolbar). */
export function runAction(name: string) {
  RUN[name]?.();
}

const hasSel = () => editor.selection.size > 0;
const isMania = () => editor.bm.general.mode === 3;

export function handleKeyDown(e: KeyboardEvent) {
  if (!editor.hasProject || editor.session === 'play' || isTyping(e) || promptOpen() || optionsOpen()) return;
  if (editor.dialog && e.key !== 'Escape') return;
  const code = layoutCode(e);
  const combo = comboOf(e, code);
  const action = combo ? actionFor(combo, editor.prefs.keybinds) : undefined;

  // The screen keys work everywhere, before Design's own keys.
  if (action && SCREEN_ACTIONS.has(action)) {
    e.preventDefault();
    RUN[action]();
    return;
  }

  // Esc cancels whatever is in progress first; otherwise it leaves the editor, like stable.
  if (e.key === 'Escape') {
    e.preventDefault();
    if (editor.dialog) editor.openDialog(null);
    else if (closeMenus()) return;
    else if (editor.screen === 'design' && design.dragging) design.cancelDrag();
    else if (editor.screen === 'compose' && activePlayfield.current?.cancel()) return;
    else void editor.exitEditor();
    return;
  }

  if (editor.screen === 'design' && handleDesignKey(code, e.ctrlKey || e.metaKey, e.shiftKey)) return e.preventDefault();
  if (editor.screen === 'timing' && code === 'KeyT' && combo === 'KeyT') return; // tap tempo is handled by the timing screen

  const run = action ? RUN[action] : undefined;
  if (run) {
    e.preventDefault();
    run();
  }
}

/** Design mode edits storyboard elements instead of hit objects. */
function handleDesignKey(code: string, ctrl: boolean, shift: boolean): boolean {
  if (ctrl) {
    if (code === 'KeyZ' && !shift) design.undo();
    else if (code === 'KeyY' || (code === 'KeyZ' && shift)) design.redo();
    else if (code === 'KeyD') design.duplicateSelected();
    else if (code === 'KeyC' || code === 'KeyX') design.copySelected(code === 'KeyX');
    else if (code === 'KeyV') design.paste();
    else if (code === 'KeyA') return true;
    else return false;
    return true;
  }
  if (code === 'Delete' || code === 'Backspace') {
    design.deleteSelected();
    return true;
  }
  // W/A/S/D nudge the selected sprite, like stable.
  const nudge: Record<string, [number, number]> = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0] };
  if (nudge[code] && !shift) {
    design.nudgeSelected(...nudge[code]);
    return true;
  }
  return /^(Digit[1-4]|Key[QWERTYGLJK])$/.test(code);
}

export function handleWheel(e: WheelEvent) {
  if (!editor.hasProject || editor.session === 'play' || editor.dialog) return;
  const target = e.target as HTMLElement;
  const area = target.closest<HTMLElement>('[data-wheel]')?.dataset.wheel;
  if (!area) return;
  e.preventDefault();
  const dir = wheelStep(e);
  if (!dir) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.altKey) {
    const tools: Tool[] = ['select', 'circle', 'slider', 'spinner'];
    const i = tools.indexOf(editor.tool);
    editor.setTool(tools[(i + dir + tools.length) % tools.length]);
    return;
  }
  if (ctrl) {
    stepDivisor(dir > 0 ? -1 : 1);
    return;
  }
  if (e.altKey) {
    if (area === 'timeline') {
      editor.setTimelineZoom(editor.bm.editor.timelineZoom * (dir > 0 ? 1 / 1.15 : 1.15), true);
    } else {
      editor.setDistanceSpacing(editor.bm.editor.distanceSpacing + (dir > 0 ? -1 : 1) * (e.shiftKey ? 0.01 : 0.1));
    }
    return;
  }
  // Wheel down seeks forward (can be inverted in preferences).
  const seekDir: 1 | -1 = editor.prefs.invertScroll ? (dir > 0 ? -1 : 1) : dir;
  editor.seekTick(seekDir, e.shiftKey ? 4 : 1);
}

// Touchpads send many small deltas: they add up to one step per mouse-wheel notch.
const NOTCH = 50;
let wheelRest = 0;

/** The wheel direction this event steps in (1 = down), or 0 while small deltas are still adding up. */
function wheelStep(e: WheelEvent): 1 | -1 | 0 {
  const d = (e.deltaY || e.deltaX) * (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 1 : 100);
  if (Math.abs(d) >= NOTCH) {
    wheelRest = 0;
    return d > 0 ? 1 : -1;
  }
  if (Math.sign(d) !== Math.sign(wheelRest)) wheelRest = 0;
  wheelRest += d;
  if (Math.abs(wheelRest) < NOTCH) return 0;
  wheelRest = 0;
  return d > 0 ? 1 : -1;
}

/**
 * A side-panel control (sampleset dropdown, a number field) keeps keyboard focus after use, which would swallow every
 * editor shortcut (Ctrl+A, Delete, 1–4...) until it's clicked away. Clicking anywhere else, or picking a dropdown value,
 * gives the keyboard back to the editor. Dialogs keep their focus.
 */
function releaseFormFocus(e: Event) {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !isFormField(a) || a.closest('.win-window')) return;
  if (e.type === 'change' ? e.target === a && a.tagName === 'SELECT' : !(e.target as HTMLElement).closest?.('input, select, textarea, [contenteditable="true"]')) a.blur();
}

export function installShortcuts() {
  window.addEventListener('pointerdown', releaseFormFocus, true);
  window.addEventListener('change', releaseFormFocus);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('wheel', handleWheel, { passive: false });
  // Nothing autosaves, so closing the tab with unsaved changes asks first.
  window.addEventListener('beforeunload', (e) => {
    if (editor.hasProject && editor.dirty) e.preventDefault();
  });
}

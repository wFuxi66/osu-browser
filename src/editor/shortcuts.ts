// Global keyboard + wheel bindings, following the osu! stable editor's defaults.
import { music } from '../audio/music';
import { activePlayfield } from './ui/Playfield';
import { editor, maniaColumn, maniaX, type Tool } from './store';
import { design } from './storyboard/design';

const DIVISORS = [1, 2, 3, 4, 6, 8, 12, 16];

function isTyping(e: Event): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
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

export function handleKeyDown(e: KeyboardEvent) {
  if (!editor.hasProject || isTyping(e)) return;
  if (editor.dialog && e.key !== 'Escape') return;
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const code = e.code;
  let handled = true;

  // Function keys
  switch (key) {
    case 'F1': editor.setScreen('compose'); break;
    case 'F2': editor.setScreen('design'); break;
    case 'F3': editor.setScreen('timing'); break;
    case 'F4': editor.openDialog('setup'); break;
    case 'F5': music.pause(); editor.openDialog('test'); break;
    case 'F6': editor.openDialog('timingPoints'); break;
    default: handled = false;
  }
  if (handled) return e.preventDefault();
  handled = true;

  if (key === 'Escape') {
    if (editor.dialog) editor.openDialog(null);
    else if (editor.screen === 'design') design.dragging ? design.cancelDrag() : design.select(null);
    else if (!activePlayfield.current?.cancel()) editor.clearSelection();
    return e.preventDefault();
  }

  if (editor.screen === 'design' && handleDesignKey(code, ctrl, shift)) return e.preventDefault();

  const hasSel = editor.selection.size > 0;
  const isMania = editor.bm.general.mode === 3;

  if (ctrl) {
    if (shift) {
      switch (code) {
        case 'KeyB': editor.removeBookmark(); break;
        case 'KeyL': editor.revertToSaved(); break;
        case 'KeyP': editor.addTimingPoint(false); break;
        case 'KeyR': if (hasSel) editor.openDialog('rotate'); break;
        case 'KeyS': if (hasSel) editor.openDialog('scale'); break;
        case 'KeyD': editor.openDialog('polygon'); break;
        case 'KeyF': if (hasSel) editor.openDialog('stream'); break;
        case 'KeyA': editor.openDialog('aimod'); break;
        case 'KeyZ': editor.redo(); break;
        case 'ArrowUp': editor.setPlaybackRate(music.rate + 0.05); break;
        case 'ArrowDown': editor.setPlaybackRate(music.rate - 0.05); break;
        default: handled = false;
      }
    } else {
      switch (code) {
        case 'KeyZ': editor.undo(); break;
        case 'KeyY': editor.redo(); break;
        case 'KeyA': editor.selectAll(); break;
        case 'KeyX': editor.copy(true); break;
        case 'KeyC': editor.copy(); break;
        case 'KeyV': editor.paste(); break;
        case 'KeyD': editor.cloneSelection(); break;
        case 'KeyS': void editor.save(); break;
        case 'KeyB': editor.addBookmark(); break;
        case 'KeyL': editor.revertToSaved(); break;
        case 'KeyO': editor.openDialog('difficulties'); break;
        case 'KeyN': if (confirm('Remove all hit objects from this difficulty?')) editor.removeAllObjects(); break;
        case 'KeyP': editor.addTimingPoint(true); break;
        case 'KeyI': editor.removeTimingPointAt(music.time); break;
        case 'KeyH': editor.flip(true); break;
        case 'KeyJ': editor.flip(false); break;
        case 'KeyG': editor.reverseSelection(); break;
        case 'Comma': editor.rotate(-90, 'playfield'); break;
        case 'Period': editor.rotate(90, 'playfield'); break;
        case 'KeyQ': editor.setSampleSet('addition', 0); break;
        case 'KeyW': editor.setSampleSet('addition', 1); break;
        case 'KeyE': editor.setSampleSet('addition', 2); break;
        case 'KeyR': editor.setSampleSet('addition', 3); break;
        case 'Digit1': editor.setGridSize(4); break;
        case 'Digit2': editor.setGridSize(8); break;
        case 'Digit3': editor.setGridSize(16); break;
        case 'Digit4': editor.setGridSize(32); break;
        case 'ArrowLeft':
          if (hasSel) isMania ? maniaShiftColumns(-1) : editor.nudgePosition(-1, 0);
          else editor.seekBookmark(-1);
          break;
        case 'ArrowRight':
          if (hasSel) isMania ? maniaShiftColumns(1) : editor.nudgePosition(1, 0);
          else editor.seekBookmark(1);
          break;
        case 'ArrowUp':
          if (hasSel) isMania ? editor.nudgeTime(1) : editor.nudgePosition(0, -1);
          else editor.setPlaybackRate(music.rate + 0.25);
          break;
        case 'ArrowDown':
          if (hasSel) isMania ? editor.nudgeTime(-1) : editor.nudgePosition(0, 1);
          else editor.setPlaybackRate(music.rate - 0.25);
          break;
        default: handled = false;
      }
    }
    if (handled) e.preventDefault();
    return;
  }

  // Alt+Q/W/E/R mirror Ctrl+Q/W/E/R, since browsers reserve Ctrl+W (close tab).
  if (alt && !shift) {
    switch (code) {
      case 'KeyQ': editor.setSampleSet('addition', 0); break;
      case 'KeyW': editor.setSampleSet('addition', 1); break;
      case 'KeyE': editor.setSampleSet('addition', 2); break;
      case 'KeyR': editor.setSampleSet('addition', 3); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
    return;
  }

  if (shift) {
    if (/^Digit[1-9]$/.test(code)) {
      editor.setBeatDivisor(Number(code.slice(5)));
      return e.preventDefault();
    }
    switch (code) {
      case 'KeyQ': editor.setSampleSet('normal', 0); break;
      case 'KeyW': editor.setSampleSet('normal', 1); break;
      case 'KeyE': editor.setSampleSet('normal', 2); break;
      case 'KeyR': editor.setSampleSet('normal', 3); break;
      case 'ArrowLeft': editor.seekTick(-1, 4); break;
      case 'ArrowRight': editor.seekTick(1, 4); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
    return;
  }

  if (editor.screen === 'timing' && code === 'KeyT') return; // tap tempo is handled by the timing screen

  switch (code) {
    case 'KeyZ': editor.seekFirstObject(); break;
    case 'KeyX':
      if (music.playing) music.seek(0);
      void music.play();
      break;
    case 'KeyC':
    case 'Space': music.toggle(); break;
    case 'KeyV': editor.seekLastObject(); break;
    case 'ArrowLeft': editor.seekTick(-1); break;
    case 'ArrowRight': editor.seekTick(1); break;
    case 'ArrowUp': editor.seekTimingPoint(1); break;
    case 'ArrowDown': editor.seekTimingPoint(-1); break;
    case 'Digit1': setTool(1); break;
    case 'Digit2': setTool(2); break;
    case 'Digit3': setTool(3); break;
    case 'Digit4': setTool(4); break;
    case 'KeyQ': editor.toggleNewCombo(); break;
    case 'KeyW': editor.toggleAddition(2); break;
    case 'KeyE': editor.toggleAddition(4); break;
    case 'KeyR': editor.toggleAddition(8); break;
    case 'KeyT': editor.gridSnap = !editor.gridSnap; editor.emit(); break;
    case 'KeyY': editor.distanceSnap = !editor.distanceSnap; editor.emit(); break;
    case 'KeyG': editor.cycleGridSize(); break;
    case 'KeyL': editor.locked = !editor.locked; editor.emit(); break;
    case 'KeyJ': editor.nudgeTime(-1); break;
    case 'KeyK': editor.nudgeTime(1); break;
    case 'Delete':
    case 'Backspace': editor.deleteSelection(); break;
    case 'Enter':
    case 'NumpadEnter': activePlayfield.current?.commitPlacement?.(); break;
    default: handled = false;
  }
  if (handled) e.preventDefault();
}

/** Design mode edits storyboard elements instead of hit objects. */
function handleDesignKey(code: string, ctrl: boolean, shift: boolean): boolean {
  if (ctrl) {
    if (code === 'KeyZ' && !shift) design.undo();
    else if (code === 'KeyY' || (code === 'KeyZ' && shift)) design.redo();
    else if (code === 'KeyD') design.duplicateSelected();
    else if (code === 'KeyA' || code === 'KeyC' || code === 'KeyX' || code === 'KeyV') return true;
    else return false;
    return true;
  }
  if (code === 'Delete' || code === 'Backspace') {
    design.deleteSelected();
    return true;
  }
  return /^(Digit[1-4]|Key[QWERTYGLJK])$/.test(code);
}

export function handleWheel(e: WheelEvent) {
  if (!editor.hasProject || editor.dialog) return;
  const target = e.target as HTMLElement;
  const area = target.closest<HTMLElement>('[data-wheel]')?.dataset.wheel;
  if (!area) return;
  e.preventDefault();
  const dir: 1 | -1 = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
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
      const z = editor.bm.editor.timelineZoom * (dir > 0 ? 1 / 1.15 : 1.15);
      editor.bm.editor.timelineZoom = Math.round(Math.max(0.1, Math.min(8, z)) * 100) / 100;
      editor.emit();
    } else {
      editor.setDistanceSpacing(editor.bm.editor.distanceSpacing + (dir > 0 ? -1 : 1) * (e.shiftKey ? 0.01 : 0.1));
    }
    return;
  }
  // Wheel up seeks forward, as in stable (can be inverted in preferences).
  const seekDir: 1 | -1 = editor.prefs.invertScroll ? dir : dir > 0 ? -1 : 1;
  editor.seekTick(seekDir, e.shiftKey ? 4 : 1);
}

export function installShortcuts() {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('beforeunload', (e) => {
    if (editor.hasProject && editor.dirty) {
      void editor.flushAutosave();
      e.preventDefault();
    }
  });
}

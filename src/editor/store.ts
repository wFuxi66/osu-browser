import { useSyncExternalStore } from 'react';
import { hitsounds } from '../audio/hitsounds';
import { music } from '../audio/music';
import { getSliderPath, sliderVertices } from '../osu/curves';
import { processBeatmap, type ProcessedBeatmap } from '../osu/processing';
import { objectEndTime, redLineAt, snapTime, sortTimingPoints, stepTick, controlPointAt, beatLengthAt, svAt } from '../osu/timing';
import {
  newObjectId,
  type Beatmap,
  type HitObject,
  type SampleSet,
  type Slider,
  type TimingPoint,
  type Vec2,
} from '../osu/types';
import { cloneBeatmap, findFile, uid, uniqueVersionName, type Project } from '../project/project';
import { loadPrefs, loadProjectLocal, saveProjectLocal, savePrefs, type Prefs } from '../project/storage';
import { cloud } from '../project/cloud';
import { ask } from '../ui/prompt';

export type Screen = 'compose' | 'design' | 'timing';
export type Tool = 'select' | 'circle' | 'slider' | 'spinner';
export type DialogName =
  | null
  | 'setup'
  | 'timingPoints'
  | 'rotate'
  | 'scale'
  | 'polygon'
  | 'stream'
  | 'aimod'
  | 'difficulties'
  | 'newDifficulty'
  | 'preferences'
  | 'shortcuts'
  | 'export'
  | 'test'
  | 'osuText'
  | 'osbText'
  | 'objectSettings';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

const MAX_UNDO = 200;
export const PLAYFIELD_W = 512;
export const PLAYFIELD_H = 384;
export const GRID_SIZES = [4, 8, 16, 32];

class Editor {
  project: Project | null = null;
  diffIndex = 0;
  screen: Screen = 'compose';
  tool: Tool = 'select';
  selection = new Set<number>();
  /** A single selected slider edge (0 = head, slides = tail) for per-edge hitsounding. */
  selectedEdge: { id: number; edge: number } | null = null;
  placement = { newCombo: false, whistle: false, finish: false, clap: false, normalSet: 0 as SampleSet, additionSet: 0 as SampleSet };
  gridSnap = true;
  distanceSnap = false;
  locked = false;
  dialog: DialogName = null;
  dirty = false;
  prefs: Prefs = loadPrefs();
  toasts: Toast[] = [];
  /** Object currently being placed (slider in progress, or a spinner waiting for its end) – drawn by the playfield. */
  placing: { kind: 'slider'; vertices: Vec2[]; time: number } | { kind: 'spinner'; time: number } | null = null;
  metronome = false;
  /** Timing tab: "Move already placed notes when changing the offset/BPM". */
  moveNotesWithTiming = true;

  rev = 0;
  contentRev = 0;
  private listeners = new Set<() => void>();
  private undoStack: Beatmap[] = [];
  private redoStack: Beatmap[] = [];
  private savedSnapshot: Beatmap | null = null;
  private processedCache: { rev: number; value: ProcessedBeatmap } | null = null;
  private clipboard: HitObject[] = [];
  private changeOpen = false;
  /** The map last open in the editor, so song select can return to it. */
  lastOpened: { projectId: string; diffId: string } | null = null;

  get bm(): Beatmap {
    return this.project!.difficulties[this.diffIndex].beatmap;
  }

  get hasProject(): boolean {
    return this.project !== null;
  }

  get processed(): ProcessedBeatmap {
    if (!this.processedCache || this.processedCache.rev !== this.contentRev) {
      this.processedCache = { rev: this.contentRev, value: processBeatmap(this.bm) };
    }
    return this.processedCache.value;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  emit() {
    this.rev++;
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: 'info' | 'error' = 'info') {
    const t = { id: Date.now() + Math.random(), text, kind };
    this.toasts = [...this.toasts, t];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x !== t);
      this.emit();
    }, kind === 'error' ? 6000 : 2500);
  }

  setPrefs(p: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
    music.el.volume = this.prefs.musicVolume;
    music.offset = this.prefs.audioOffset;
    hitsounds.setVolume(this.prefs.hitsoundVolume);
    this.emit();
  }

  // ---------------------------------------------------------------- project lifecycle

  async openProject(p: Project, diffIndex = 0) {
    this.project = p;
    this.diffIndex = Math.min(diffIndex, p.difficulties.length - 1);
    this.selection.clear();
    this.selectedEdge = null;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.placing = null;
    this.savedSnapshot = cloneBeatmap(this.bm);
    this.screen = 'compose';
    this.tool = 'select';
    this.contentRev++;
    this.setPrefs({});
    const audio = findFile(p, this.bm.general.audioFilename);
    await music.load(audio ?? null);
    void hitsounds.setCustomSamples(p.files, this.bm.general.audioFilename);
    this.emit();
    if (!audio) this.toast(`Audio file "${this.bm.general.audioFilename}" is missing from this beatmap.`, 'error');
  }

  /** Leave the editor without saving (unsaved changes only live in memory, so they are dropped). */
  closeProject() {
    music.pause();
    if (this.project) this.lastOpened = { projectId: this.project.id, diffId: this.project.difficulties[this.diffIndex].id };
    this.project = null;
    this.dialog = null;
    this.placing = null;
    this.dirty = false;
    this.emit();
  }

  /**
   * If there are unsaved changes, ask whether to save them first. Resolves false when the user cancels.
   * "No" reloads the last saved version, so the changes are really discarded.
   */
  async resolveUnsaved(action: string): Promise<boolean> {
    if (!this.project || !this.dirty) return true;
    music.pause();
    const r = await ask({
      look: 'game',
      title: 'Save changes?',
      message: `You have unsaved changes. Would you like to save them before ${action}?`,
      buttons: [
        { label: 'Yes', value: 'yes', tone: 'pink' },
        { label: 'No', value: 'no', tone: 'blue' },
        { label: 'Cancel', value: 'cancel', tone: 'grey' },
      ],
      cancelValue: 'cancel',
    });
    if (r === 'cancel') return false;
    if (r === 'yes') await this.save();
    else await this.discardChanges();
    return true;
  }

  /** Esc / File → Exit: back to song select, asking to save first if there are unsaved changes. */
  async exitEditor() {
    if (await this.resolveUnsaved('exiting')) this.closeProject();
  }

  /** Throw away unsaved edits by reloading the project as it was last saved. */
  async discardChanges() {
    if (!this.project) return;
    const diffId = this.project.difficulties[this.diffIndex].id;
    const fresh = await loadProjectLocal(this.project.id);
    this.dirty = false;
    if (!fresh) return;
    this.project = fresh;
    this.diffIndex = Math.max(0, fresh.difficulties.findIndex((d) => d.id === diffId));
    this.selection.clear();
    this.selectedEdge = null;
    this.undoStack = [];
    this.redoStack = [];
    this.placing = null;
    this.savedSnapshot = cloneBeatmap(this.bm);
    this.contentRev++;
    void hitsounds.setCustomSamples(fresh.files, this.bm.general.audioFilename);
    this.emit();
  }

  /** Open another difficulty of this set, asking to save the current one first, like stable. */
  async requestSwitchDifficulty(id: string) {
    if (!this.project || this.project.difficulties[this.diffIndex].id === id) return;
    if (!(await this.resolveUnsaved('switching difficulty'))) return;
    const i = this.project.difficulties.findIndex((d) => d.id === id);
    if (i >= 0) await this.switchDifficulty(i);
  }

  async switchDifficulty(i: number) {
    if (!this.project || i === this.diffIndex) return;
    const t = music.time;
    const prevAudio = this.bm.general.audioFilename;
    this.diffIndex = i;
    this.selection.clear();
    this.selectedEdge = null;
    this.undoStack = [];
    this.redoStack = [];
    this.placing = null;
    this.savedSnapshot = cloneBeatmap(this.bm);
    this.contentRev++;
    if (this.bm.general.audioFilename !== prevAudio) await music.load(findFile(this.project, this.bm.general.audioFilename) ?? null);
    music.seek(t);
    this.emit();
  }

  /** Draft for File → Create a new Difficulty, edited by Song Setup until OK. */
  pendingNewDifficulty: Beatmap | null = null;

  /** Stable's flow: ask whether to keep the objects, then fill in Song Setup for the new difficulty. */
  async beginNewDifficulty() {
    if (!this.project) return;
    const r = await ask({
      look: 'win',
      title: 'osu!',
      message: 'Would you like to copy the hit objects from the current difficulty to the new one?\nTiming and song setup are always copied.',
      buttons: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }, { label: 'Cancel', value: 'cancel' }],
      cancelValue: 'cancel',
    });
    if (r === 'cancel') return;
    const bm = cloneBeatmap(this.bm);
    bm.metadata.version = '';
    bm.metadata.beatmapId = 0;
    if (r === 'no') {
      bm.hitObjects = [];
      bm.events.breaks = [];
      bm.editor.bookmarks = [];
      bm.timingPoints = bm.timingPoints.filter((t) => t.uninherited);
    } else bm.hitObjects.forEach((o) => (o.id = newObjectId()));
    this.pendingNewDifficulty = bm;
    this.openDialog('setup');
  }

  /** Song Setup OK for a new difficulty: the current one keeps its last saved state, the new one is saved. */
  async commitNewDifficulty() {
    const bm = this.pendingNewDifficulty;
    if (!this.project || !bm) return;
    this.pendingNewDifficulty = null;
    bm.metadata.version = uniqueVersionName(this.project, bm.metadata.version.trim() || 'New Difficulty');
    if (this.savedSnapshot) this.project.difficulties[this.diffIndex].beatmap = cloneBeatmap(this.savedSnapshot);
    this.project.difficulties.push({ id: uid(), beatmap: bm });
    await this.switchDifficulty(this.project.difficulties.length - 1);
    await this.save();
  }

  // ---------------------------------------------------------------- stable menu actions

  /** Edit → Reset selected objects' samples / Reset all samples: back to no additions and auto sample sets. */
  resetSamples(all: boolean) {
    const objs = all ? this.bm.hitObjects : this.selectedObjects;
    if (!objs.length) return;
    this.commit(() =>
      objs.forEach((o) => {
        o.hitSound = 0;
        o.sample = { normalSet: 0, additionSet: 0, index: 0, volume: 0, filename: '' };
        if (o.kind === 'slider') {
          o.edgeSounds = o.edgeSounds.map(() => 0);
          o.edgeSets = o.edgeSets.map(() => ({ normal: 0, addition: 0 }));
        }
      }),
    );
  }

  /** Edit → Reset combo colours: drop every colour skip. */
  resetComboColours() {
    this.commit((b) => b.hitObjects.forEach((o) => (o.comboSkip = 0)));
  }

  /** Edit → Reset breaks: recalculate break periods to sit next to the surrounding objects. */
  resetBreaks(breaks: Beatmap['events']['breaks']) {
    this.commit((b) => (b.events.breaks = breaks));
  }

  /** Timing → Resnap Current Section: resnap the objects under the red line in effect now. */
  resnapCurrentSection() {
    const bm = this.bm;
    const red = redLineAt(bm, music.time);
    const reds = bm.timingPoints.filter((t) => t.uninherited);
    const next = reds.find((t) => t.time > red.time);
    const first = red === reds[0];
    const objs = bm.hitObjects.filter((o) => (first || o.time >= red.time - 0.5) && (!next || o.time < next.time - 0.5));
    this.resnapList(objs);
  }

  /** Timing → Move all notes in time. */
  moveAllNotes(ms: number) {
    if (!ms) return;
    this.commit((b) => b.hitObjects.forEach((o) => shiftObjectTime(o, Math.round(ms))));
  }

  /** Timing → Recalculate Slider Lengths: snap every slider end to the nearest tick it can reach. */
  recalculateSliderLengths() {
    const bm = this.bm;
    this.commit(() => bm.hitObjects.forEach((o) => o.kind === 'slider' && snapSliderLength(bm, o, this.beatDivisor)));
  }

  /** Timing → Time Signature: meter of the current red line. */
  setTimeSignature(meter: number) {
    const red = redLineAt(this.bm, music.time);
    const i = this.bm.timingPoints.indexOf(red);
    if (i >= 0) this.updateTimingPoint(i, { meter });
  }

  /** Create a new difficulty, optionally copying timing (and objects). */
  addDifficulty(name: string, opts: { copyObjects: boolean; mode?: number }) {
    if (!this.project) return;
    const src = this.bm;
    const bm = cloneBeatmap(src);
    bm.metadata.version = uniqueVersionName(this.project, name || 'New Difficulty');
    bm.metadata.beatmapId = 0;
    if (!opts.copyObjects) {
      bm.hitObjects = [];
      bm.events.breaks = [];
      bm.editor.bookmarks = [];
      bm.timingPoints = bm.timingPoints.filter((t) => t.uninherited);
    } else {
      bm.hitObjects.forEach((o) => (o.id = newObjectId()));
    }
    if (opts.mode !== undefined) bm.general.mode = opts.mode as Beatmap['general']['mode'];
    this.project.difficulties.push({ id: uid(), beatmap: bm });
    this.markDirty();
    void this.switchDifficulty(this.project.difficulties.length - 1);
  }

  deleteDifficulty(i: number) {
    if (!this.project || this.project.difficulties.length <= 1) return;
    this.project.difficulties.splice(i, 1);
    this.diffIndex = Math.min(this.diffIndex, this.project.difficulties.length - 1);
    this.selection.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.savedSnapshot = cloneBeatmap(this.bm);
    this.contentRev++;
    this.markDirty();
  }

  setFile(name: string, blob: Blob | null) {
    if (!this.project) return;
    if (blob) this.project.files.set(name, blob);
    else this.project.files.delete(name);
    this.markDirty();
  }

  async replaceAudio(file: File) {
    if (!this.project) return;
    const ext = (/\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? '.mp3').toLowerCase();
    const name = `audio${ext}`;
    const old = this.bm.general.audioFilename;
    if (old !== name && !this.project.difficulties.some((d, i) => i !== this.diffIndex && d.beatmap.general.audioFilename === old)) {
      this.project.files.delete(old);
    }
    this.project.files.set(name, file);
    for (const d of this.project.difficulties) d.beatmap.general.audioFilename = name;
    await music.load(file);
    this.markDirty();
  }

  markDirty() {
    if (!this.project) return;
    this.dirty = true;
    this.project.updatedAt = Date.now();
    this.contentRev++;
    this.emit();
  }

  /** Ctrl+S: write the whole set to browser storage, then sync it to the account if logged in. */
  async save() {
    if (!this.project) return;
    this.project.updatedAt = Date.now();
    try {
      await saveProjectLocal(this.project);
    } catch (e) {
      console.error(e);
      this.toast('Saving failed: browser storage is unavailable or full.', 'error');
      return;
    }
    this.dirty = false;
    this.savedSnapshot = cloneBeatmap(this.bm);
    this.emit();
    if (cloud.user) {
      try {
        await cloud.upload(this.project);
        this.toast('Saved and synced to your account.');
      } catch (e) {
        this.toast(`Saved locally. Cloud sync failed: ${(e as Error).message}`, 'error');
      }
    } else {
      this.toast('Saved.');
    }
  }

  /** Ctrl+Shift+L: reload the whole set (all difficulties, storyboard and files) from the last save. */
  async revertToSavedFull() {
    if (!this.project) return;
    const t = music.time;
    await this.discardChanges();
    if (this.project) await music.load(findFile(this.project, this.bm.general.audioFilename) ?? null);
    music.seek(t);
    this.toast('Reverted to the last save.');
  }

  /** Ctrl+N: remove every hit object, after asking. */
  async clearAllNotes() {
    if (!this.project) return;
    const ok = await ask({
      look: 'win',
      title: 'osu!',
      message: 'Are you sure you want to clear all notes?',
      buttons: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }],
      cancelValue: 'no',
    });
    if (ok === 'yes') this.removeAllObjects();
  }

  /** Ctrl+P / Ctrl+Shift+P: add a timing section; outside the Timing tab this also opens Timing Setup, like stable. */
  addTimingSection(uninherited: boolean) {
    this.addTimingPoint(uninherited);
    if (this.screen !== 'timing') this.openDialog('timingPoints');
  }

  /** Ctrl+I: delete the current timing section, except the first red line. */
  deleteTimingSection() {
    const bm = this.bm;
    const cur = controlPointAt(bm, music.time);
    const firstRed = bm.timingPoints.find((t) => t.uninherited);
    if (cur === firstRed) {
      this.toast("The first timing point can't be deleted.", 'error');
      return;
    }
    this.removeTimingPointAt(music.time);
  }

  revertToSaved() {
    if (!this.savedSnapshot || !this.project) return;
    this.pushUndo();
    this.project.difficulties[this.diffIndex].beatmap = cloneBeatmap(this.savedSnapshot);
    this.selection.clear();
    this.markDirty();
    this.dirty = false;
    this.emit();
  }

  // ---------------------------------------------------------------- undo / redo

  private pushUndo() {
    this.undoStack.push(cloneBeatmap(this.bm));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Run a mutation as one undoable step. */
  commit(fn: (bm: Beatmap) => void) {
    if (!this.project) return;
    if (!this.changeOpen) this.pushUndo();
    fn(this.bm);
    this.normalize();
    this.markDirty();
  }

  /** Start a continuous change (e.g. a drag). Call `touch()` while it runs and `endChange()` at the end. */
  beginChange() {
    if (!this.project || this.changeOpen) return;
    this.pushUndo();
    this.changeOpen = true;
  }

  touch() {
    this.contentRev++;
    this.emit();
  }

  endChange() {
    if (!this.changeOpen) return;
    this.changeOpen = false;
    this.normalize();
    this.markDirty();
  }

  cancelChange() {
    if (!this.changeOpen) return;
    this.changeOpen = false;
    const prev = this.undoStack.pop();
    if (prev && this.project) this.project.difficulties[this.diffIndex].beatmap = prev;
    this.contentRev++;
    this.emit();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev || !this.project) return;
    this.redoStack.push(cloneBeatmap(this.bm));
    this.project.difficulties[this.diffIndex].beatmap = prev;
    this.pruneSelection();
    this.markDirty();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next || !this.project) return;
    this.undoStack.push(cloneBeatmap(this.bm));
    this.project.difficulties[this.diffIndex].beatmap = next;
    this.pruneSelection();
    this.markDirty();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  private pruneSelection() {
    const ids = new Set(this.bm.hitObjects.map((o) => o.id));
    for (const id of this.selection) if (!ids.has(id)) this.selection.delete(id);
  }

  private normalize() {
    const bm = this.bm;
    bm.hitObjects.sort((a, b) => a.time - b.time);
    sortTimingPoints(bm.timingPoints);
    bm.editor.bookmarks.sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------- editor settings

  setTool(t: Tool) {
    this.tool = t;
    this.placing = null;
    if (t !== 'select') {
      this.selection.clear();
      this.selectedEdge = null;
    }
    this.emit();
  }

  setScreen(s: Screen) {
    this.screen = s;
    this.placing = null;
    this.emit();
  }

  openDialog(d: DialogName) {
    this.dialog = d;
    this.emit();
  }

  get beatDivisor() {
    return this.project ? this.bm.editor.beatDivisor : 4;
  }
  setBeatDivisor(d: number) {
    this.bm.editor.beatDivisor = Math.max(1, Math.min(16, d));
    this.emit();
  }

  get gridSize() {
    return this.project ? this.bm.editor.gridSize : 32;
  }
  setGridSize(g: number) {
    this.bm.editor.gridSize = g;
    this.emit();
  }
  cycleGridSize() {
    const i = GRID_SIZES.indexOf(this.gridSize);
    this.setGridSize(GRID_SIZES[(i + 1) % GRID_SIZES.length]);
  }

  setDistanceSpacing(v: number) {
    this.bm.editor.distanceSpacing = Math.round(Math.max(0.1, Math.min(6, v)) * 100) / 100;
    this.emit();
  }

  setPlaybackRate(r: number) {
    music.rate = Math.max(0.25, Math.min(1, Math.round(r * 100) / 100));
    this.emit();
  }

  // ---------------------------------------------------------------- navigation

  snap(time: number) {
    return snapTime(this.bm, time, this.beatDivisor);
  }

  seek(time: number) {
    music.seek(time);
  }

  seekTick(direction: 1 | -1, multiplier = 1) {
    let t = music.time;
    if (music.playing) {
      t += direction * beatLengthAt(this.bm, t) * multiplier;
      music.seek(t);
      return;
    }
    for (let i = 0; i < multiplier; i++) t = stepTick(this.bm, t, this.beatDivisor, direction);
    music.seek(t);
  }

  seekTimingPoint(direction: 1 | -1) {
    const t = music.time;
    const tps = this.bm.timingPoints;
    const target = direction > 0 ? tps.find((tp) => tp.time > t + 1) : [...tps].reverse().find((tp) => tp.time < t - 1);
    if (target) music.seek(target.time);
  }

  seekBookmark(direction: 1 | -1) {
    const t = music.time;
    const b = this.bm.editor.bookmarks;
    const target = direction > 0 ? b.find((x) => x > t + 1) : [...b].reverse().find((x) => x < t - 1);
    if (target !== undefined) music.seek(target);
  }

  seekFirstObject() {
    const first = this.bm.hitObjects[0];
    music.seek(first && music.time > first.time + 1 ? first.time : 0);
  }

  seekLastObject() {
    const last = this.bm.hitObjects[this.bm.hitObjects.length - 1];
    const end = last ? objectEndTime(this.bm, last) : music.duration;
    music.seek(last && music.time < end - 1 ? end : music.duration);
  }

  // ---------------------------------------------------------------- selection

  get selectedObjects(): HitObject[] {
    return this.bm.hitObjects.filter((o) => this.selection.has(o.id));
  }

  select(ids: Iterable<number>, additive = false) {
    if (!additive) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.selectedEdge = null;
    this.emit();
  }

  toggleSelect(id: number) {
    if (this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    this.selectedEdge = null;
    this.emit();
  }

  clearSelection() {
    if (this.selection.size === 0 && !this.selectedEdge) return;
    this.selection.clear();
    this.selectedEdge = null;
    this.emit();
  }

  selectAll() {
    this.tool = 'select';
    this.select(this.bm.hitObjects.map((o) => o.id));
  }

  // ---------------------------------------------------------------- object editing

  addObject(o: HitObject) {
    this.commit((bm) => {
      // Placing on top of an existing object at the same time replaces it, like stable.
      bm.hitObjects = bm.hitObjects.filter((x) => Math.abs(x.time - o.time) >= 1 || x.kind === 'spinner' !== (o.kind === 'spinner') || bm.general.mode === 3);
      bm.hitObjects.push(o);
    });
    if (this.placement.newCombo) {
      this.placement.newCombo = false;
      this.emit();
    }
  }

  /** Hitsound bits and sample for a new object, from the placement panel. */
  placementSound(): { hitSound: number; sample: HitObject['sample'] } {
    const pl = this.placement;
    return {
      hitSound: (pl.whistle ? 2 : 0) | (pl.finish ? 4 : 0) | (pl.clap ? 8 : 0),
      sample: { normalSet: pl.normalSet, additionSet: pl.additionSet, index: 0, volume: 0, filename: '' },
    };
  }

  /**
   * Stable-style spinner placement: the first click starts a spinner at the current time, a second click
   * after seeking forward ends it there.
   */
  spinnerClick(x = 256, y = 192) {
    const time = Math.round(this.snap(music.time));
    const p = this.placing;
    if (p?.kind !== 'spinner') {
      this.placing = { kind: 'spinner', time };
      this.emit();
      return;
    }
    if (time <= p.time) {
      this.toast('Seek forward to where the spinner should end, then click again.');
      return;
    }
    this.placing = null;
    // stable always flags spinners as new combo
    this.addObject({ id: newObjectId(), kind: 'spinner', x, y, time: p.time, endTime: time, newCombo: true, comboSkip: 0, ...this.placementSound() });
  }

  deleteSelection() {
    if (this.selection.size === 0) return;
    this.commit((bm) => {
      bm.hitObjects = bm.hitObjects.filter((o) => !this.selection.has(o.id));
    });
    this.selection.clear();
    this.selectedEdge = null;
    this.emit();
  }

  deleteObject(id: number) {
    this.commit((bm) => {
      bm.hitObjects = bm.hitObjects.filter((o) => o.id !== id);
    });
    this.selection.delete(id);
    this.emit();
  }

  removeAllObjects() {
    this.commit((bm) => {
      bm.hitObjects = [];
    });
    this.selection.clear();
  }

  toggleNewCombo() {
    const sel = this.selectedObjects;
    if (sel.length === 0) {
      this.placement.newCombo = !this.placement.newCombo;
      this.emit();
      return;
    }
    const value = !sel.every((o) => o.newCombo);
    this.commit(() => sel.forEach((o) => (o.newCombo = value)));
  }

  setComboSkip(n: number) {
    const sel = this.selectedObjects;
    if (!sel.length) return;
    this.commit(() => sel.forEach((o) => (o.comboSkip = Math.max(0, Math.min(7, n)))));
  }

  /** Toggle whistle/finish/clap (bit 2/4/8) on the selection, or the selected slider edge, or placement. */
  toggleAddition(bit: number) {
    const sel = this.selectedObjects;
    const key = bit === 2 ? 'whistle' : bit === 4 ? 'finish' : 'clap';
    if (sel.length === 0) {
      this.placement[key] = !this.placement[key];
      this.emit();
      return;
    }
    const edge = this.selectedEdge;
    if (edge && sel.length === 1 && sel[0].id === edge.id && sel[0].kind === 'slider') {
      const s = sel[0];
      this.commit(() => {
        s.edgeSounds[edge.edge] = (s.edgeSounds[edge.edge] ?? 0) ^ bit;
      });
      return;
    }
    const has = (o: HitObject) => (o.kind === 'slider' ? o.edgeSounds.every((e) => e & bit) : (o.hitSound & bit) !== 0);
    const value = !sel.every(has);
    this.commit(() => {
      for (const o of sel) {
        o.hitSound = value ? o.hitSound | bit : o.hitSound & ~bit;
        if (o.kind === 'slider') o.edgeSounds = o.edgeSounds.map((e) => (value ? e | bit : e & ~bit));
      }
    });
  }

  setSampleSet(which: 'normal' | 'addition', set: SampleSet) {
    const sel = this.selectedObjects;
    if (sel.length === 0) {
      if (which === 'normal') this.placement.normalSet = set;
      else this.placement.additionSet = set;
      this.emit();
      return;
    }
    const edge = this.selectedEdge;
    this.commit(() => {
      for (const o of sel) {
        if (edge && o.kind === 'slider' && o.id === edge.id) {
          const e = o.edgeSets[edge.edge];
          if (e) e[which] = set;
          continue;
        }
        if (which === 'normal') o.sample.normalSet = set;
        else o.sample.additionSet = set;
        if (o.kind === 'slider') o.edgeSets.forEach((e) => (e[which] = set));
      }
    });
  }

  /** Sample settings (bits + sets) of the selection for UI display. */
  selectionHitsoundState() {
    const sel = this.selectedObjects;
    if (sel.length === 0) {
      const p = this.placement;
      return { whistle: p.whistle, finish: p.finish, clap: p.clap, newCombo: p.newCombo, normalSet: p.normalSet, additionSet: p.additionSet };
    }
    const edge = this.selectedEdge;
    if (edge && sel.length === 1 && sel[0].kind === 'slider') {
      const s = sel[0];
      const bits = s.edgeSounds[edge.edge] ?? 0;
      const sets = s.edgeSets[edge.edge] ?? { normal: 0, addition: 0 };
      return { whistle: !!(bits & 2), finish: !!(bits & 4), clap: !!(bits & 8), newCombo: s.newCombo, normalSet: sets.normal, additionSet: sets.addition };
    }
    const all = (f: (o: HitObject) => boolean) => sel.every(f);
    const bit = (b: number) => (o: HitObject) => (o.kind === 'slider' ? o.edgeSounds.every((e) => e & b) : (o.hitSound & b) !== 0);
    return {
      whistle: all(bit(2)),
      finish: all(bit(4)),
      clap: all(bit(8)),
      newCombo: all((o) => o.newCombo),
      normalSet: sel.every((o) => o.sample.normalSet === sel[0].sample.normalSet) ? sel[0].sample.normalSet : (-1 as unknown as SampleSet),
      additionSet: sel.every((o) => o.sample.additionSet === sel[0].sample.additionSet) ? sel[0].sample.additionSet : (-1 as unknown as SampleSet),
    };
  }

  /** Move selected objects in time by a number of divisor ticks. */
  nudgeTime(ticks: number) {
    const sel = this.selectedObjects;
    if (!sel.length) return;
    const first = sel[0];
    let target = first.time;
    for (let i = 0; i < Math.abs(ticks); i++) target = stepTick(this.bm, target, this.beatDivisor, ticks > 0 ? 1 : -1);
    const delta = Math.round(target) - first.time;
    this.commit(() => sel.forEach((o) => shiftObjectTime(o, delta)));
  }

  nudgePosition(dx: number, dy: number) {
    const sel = this.selectedObjects;
    if (!sel.length) return;
    this.commit(() => sel.forEach((o) => translateObject(o, dx, dy)));
  }

  transformSelection(fn: (p: Vec2) => Vec2) {
    const sel = this.selectedObjects;
    if (!sel.length) return;
    this.commit(() => {
      for (const o of sel) {
        if (o.kind === 'spinner') continue;
        const h = fn({ x: o.x, y: o.y });
        if (o.kind === 'slider') o.points = o.points.map(fn);
        o.x = h.x;
        o.y = h.y;
      }
    });
  }

  selectionCentre(): Vec2 {
    const sel = this.selectedObjects.filter((o) => o.kind !== 'spinner');
    if (!sel.length) return { x: PLAYFIELD_W / 2, y: PLAYFIELD_H / 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of sel) {
      const pts = o.kind === 'slider' ? getSliderPath(o).points : [{ x: o.x, y: o.y }];
      for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  flip(horizontal: boolean, aroundSelection = false) {
    const c = aroundSelection ? this.selectionCentre() : { x: PLAYFIELD_W / 2, y: PLAYFIELD_H / 2 };
    this.transformSelection((p) => (horizontal ? { x: 2 * c.x - p.x, y: p.y } : { x: p.x, y: 2 * c.y - p.y }));
  }

  rotate(degrees: number, pivot: 'playfield' | 'selection') {
    const c = pivot === 'selection' ? this.selectionCentre() : { x: PLAYFIELD_W / 2, y: PLAYFIELD_H / 2 };
    const r = (degrees * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    this.transformSelection((p) => ({
      x: Math.round(c.x + (p.x - c.x) * cos - (p.y - c.y) * sin),
      y: Math.round(c.y + (p.x - c.x) * sin + (p.y - c.y) * cos),
    }));
  }

  scale(factor: number, pivot: 'playfield' | 'selection', axes: { x: boolean; y: boolean }) {
    const c = pivot === 'selection' ? this.selectionCentre() : { x: PLAYFIELD_W / 2, y: PLAYFIELD_H / 2 };
    // Slider lengths are kept so rhythm doesn't change; the path is clipped/extended to fit.
    this.transformSelection((p) => ({
      x: axes.x ? Math.round(c.x + (p.x - c.x) * factor) : p.x,
      y: axes.y ? Math.round(c.y + (p.y - c.y) * factor) : p.y,
    }));
  }

  /** Reverse the time order of the selection (Ctrl+G). */
  reverseSelection() {
    const sel = this.selectedObjects;
    if (!sel.length) return;
    const bm = this.bm;
    const start = Math.min(...sel.map((o) => o.time));
    const end = Math.max(...sel.map((o) => objectEndTime(bm, o)));
    this.commit(() => {
      for (const o of sel) {
        const oe = objectEndTime(bm, o);
        const newStart = Math.round(start + end - oe);
        if (o.kind === 'slider') reverseSliderPath(o);
        if (o.kind === 'spinner' || o.kind === 'hold') o.endTime = newStart + (o.endTime - o.time);
        o.time = newStart;
      }
    });
  }

  copy(cut = false) {
    const sel = this.selectedObjects;
    if (!sel.length) return;
    this.clipboard = structuredClone(sel);
    const text = `${formatTimestamp(sel[0].time)} (${sel.map((o) => this.objectLabel(o)).join(',')}) - `;
    navigator.clipboard?.writeText(text).catch(() => undefined);
    if (cut) this.deleteSelection();
  }

  paste() {
    if (!this.clipboard.length) return;
    const t = Math.round(this.snap(music.time));
    const base = this.clipboard[0].time;
    const pasted = structuredClone(this.clipboard).map((o) => {
      o.id = newObjectId();
      shiftObjectTime(o, t - base);
      return o;
    });
    this.commit((bm) => bm.hitObjects.push(...pasted));
    this.select(pasted.map((o) => o.id));
  }

  /** Ctrl+D: duplicate the selection one measure later. */
  cloneSelection() {
    const sel = this.selectedObjects;
    if (!sel.length) return;
    const red = redLineAt(this.bm, sel[0].time);
    const delta = Math.round(red.beatLength * red.meter);
    const copies = structuredClone(sel).map((o) => {
      o.id = newObjectId();
      shiftObjectTime(o, delta);
      return o;
    });
    this.commit((bm) => bm.hitObjects.push(...copies));
    this.select(copies.map((o) => o.id));
  }

  /** "1,2,3" style combo labels used in timestamps. */
  objectLabel(o: HitObject): string {
    if (this.bm.general.mode === 3) return `${Math.round(o.time)}|${maniaColumn(o.x, this.bm.difficulty.circleSize)}`;
    return String(this.processed.info.get(o.id)?.comboNumber ?? '?');
  }

  resnapObjects(all: boolean) {
    this.resnapList(all || this.selection.size === 0 ? this.bm.hitObjects : this.selectedObjects);
  }

  private resnapList(objs: HitObject[]) {
    const bm = this.bm;
    this.commit(() => {
      for (const o of objs) {
        const snapped = Math.round(this.snap(o.time));
        const delta = snapped - o.time;
        shiftObjectTime(o, delta);
        if (o.kind === 'spinner' || o.kind === 'hold') o.endTime = Math.round(this.snap(o.endTime));
        if (o.kind === 'slider') snapSliderLength(bm, o, this.beatDivisor);
      }
    });
  }

  // ---------------------------------------------------------------- timing / bookmarks

  addTimingPoint(uninherited: boolean, time = Math.round(music.time)) {
    const bm = this.bm;
    const cur = controlPointAt(bm, time);
    const red = redLineAt(bm, time);
    const tp: TimingPoint = {
      time,
      beatLength: uninherited ? (bm.timingPoints.some((t) => t.uninherited) ? red.beatLength : 500) : cur.uninherited ? -100 : cur.beatLength,
      meter: red.meter,
      sampleSet: cur.sampleSet,
      sampleIndex: cur.sampleIndex,
      volume: cur.volume,
      uninherited,
      kiai: cur.kiai,
      omitFirstBarLine: false,
    };
    this.commit((b) => {
      b.timingPoints = b.timingPoints.filter((t) => !(t.time === time && t.uninherited === uninherited));
      b.timingPoints.push(tp);
    });
    return tp;
  }

  /**
   * Timing tab BPM/offset changes to the red line in effect now. With "Move already placed notes" on, the
   * objects and green lines of that section follow, so they stay on the same ticks.
   */
  adjustCurrentRedLine(patch: { time?: number; beatLength?: number }) {
    const bm = this.bm;
    const reds = bm.timingPoints.filter((t) => t.uninherited);
    if (!reds.length) return;
    const red = redLineAt(bm, music.time);
    const i = bm.timingPoints.indexOf(red);
    const next = reds.find((t) => t.time > red.time);
    const isFirst = red === reds[0];
    const end = next ? next.time : Infinity;
    const newTime = Math.round(patch.time ?? red.time);
    const newBL = patch.beatLength ?? red.beatLength;
    if (!(newBL > 0)) return;
    const map = (t: number) => Math.round(newTime + (t - red.time) * (newBL / red.beatLength));
    const inSection = (t: number) => t < end - 0.5 && (isFirst || t >= red.time - 0.5);
    this.commit((b) => {
      if (this.moveNotesWithTiming) {
        for (const o of b.hitObjects) {
          if (!inSection(o.time)) continue;
          if (o.kind === 'spinner' || o.kind === 'hold') o.endTime = map(o.endTime);
          o.time = map(o.time);
        }
        b.timingPoints.forEach((tp, k) => {
          if (k !== i && !tp.uninherited && inSection(tp.time)) tp.time = map(tp.time);
        });
      }
      b.timingPoints[i].time = newTime;
      b.timingPoints[i].beatLength = newBL;
    });
  }

  removeTimingPointAt(time: number) {
    const bm = this.bm;
    const cur = controlPointAt(bm, time);
    if (!bm.timingPoints.includes(cur)) return;
    this.commit((b) => {
      b.timingPoints = b.timingPoints.filter((t) => t !== cur);
    });
  }

  updateTimingPoint(index: number, patch: Partial<TimingPoint>) {
    this.commit((bm) => Object.assign(bm.timingPoints[index], patch));
  }

  addBookmark(time = Math.round(music.time)) {
    this.commit((bm) => {
      if (!bm.editor.bookmarks.some((b) => Math.abs(b - time) < 1)) bm.editor.bookmarks.push(time);
    });
  }

  removeBookmark(time = Math.round(music.time)) {
    this.commit((bm) => {
      bm.editor.bookmarks = bm.editor.bookmarks.filter((b) => Math.abs(b - time) > 100);
    });
  }
}

// ------------------------------------------------------------------ object helpers

export function shiftObjectTime(o: HitObject, delta: number) {
  o.time += delta;
  if (o.kind === 'spinner' || o.kind === 'hold') o.endTime += delta;
}

export function translateObject(o: HitObject, dx: number, dy: number) {
  if (o.kind === 'spinner') return;
  o.x += dx;
  o.y += dy;
  if (o.kind === 'slider') o.points = o.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function reverseSliderPath(s: Slider) {
  const path = getSliderPath(s);
  const verts = sliderVertices(s);
  // Pin the last control point to the actual (clipped) end so the reversed slider starts where this one ended.
  const end = path.positionAt(1);
  verts[verts.length - 1] = { x: Math.round(end.x), y: Math.round(end.y) };
  verts.reverse();
  s.x = verts[0].x;
  s.y = verts[0].y;
  s.points = verts.slice(1);
  s.edgeSounds.reverse();
  s.edgeSets.reverse();
}

/** Clamp a slider's length to a whole number of divisor ticks that fits its path. */
export function snapSliderLength(bm: Beatmap, s: Slider, divisor: number) {
  const raw = getSliderPath({ ...s, length: 0 }).rawLength;
  const ppb = bm.difficulty.sliderMultiplier * 100 * svAt(bm, s.time);
  const tickLen = ppb / divisor;
  if (tickLen <= 0) return;
  const ticks = Math.max(1, Math.floor((Math.min(s.length || raw, raw) + 0.01) / tickLen));
  s.length = Number((ticks * tickLen).toFixed(6));
}

export function maniaColumn(x: number, keys: number): number {
  const k = Math.max(1, Math.round(keys));
  return Math.min(k - 1, Math.max(0, Math.floor((x * k) / 512)));
}

export function maniaX(column: number, keys: number): number {
  const k = Math.max(1, Math.round(keys));
  return Math.floor(((column + 0.5) * 512) / k);
}

export function formatTimestamp(ms: number): string {
  const neg = ms < 0;
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(r).padStart(3, '0')}`;
}

export const editor = new Editor();
(window as unknown as { editor: Editor }).editor = editor;

export function useEditor(): Editor {
  useSyncExternalStore(editor.subscribe, () => editor.rev);
  return editor;
}

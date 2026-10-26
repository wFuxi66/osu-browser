// osu!standard gameplay as stable plays it: hit windows and notelock, sliders judged by their head, ticks, repeats and
// tail, spinners by rotations, health drain, ScoreV1 (or ScoreV2) and every mod's effect. Rendering is here too, so
// the objects disappear as they're actually hit.
import { hitsounds, objectSoundEvents, objectSustainedSounds, type SoundEvent } from '../audio/hitsounds';
import { dist, getSliderPath, sliderPositionAtSpan } from '../osu/curves';
import { comboColourIndex, hitWindows, processBeatmap, sliderTickProgresses, stackedPosition, type ProcessedBeatmap } from '../osu/processing';
import { objectEndTime, sliderSpanDuration } from '../osu/timing';
import type { Beatmap, BreakPeriod, HitObject, Rgb, Vec2 } from '../osu/types';
import { comboColours, skins, sliderColours, type Texture } from '../skin/skin';
import {
  drawApproachCircle,
  drawFollowPoints,
  drawHitCircle,
  drawReverseArrow,
  drawSliderBall,
  drawSliderBody,
  drawSliderEndCircle,
  drawSliderTick,
  drawTexture,
  toScreen,
  type View,
} from '../editor/render/draw';
import { isAuto, moddedBeatmap, rateOf, scoreMultiplier, type ModId } from './mods';
import type { Counts } from './scores';

export type Judgement = 300 | 100 | 50 | 0;

/** Clicking this long before an object is a miss rather than a shake, as in stable. */
const MISS_WINDOW = 400;
/** Stable judges the slider tail this early ("legacy last tick"). */
const TAIL_LENIENCY = 36;
const SPINNER_CENTRE: Vec2 = { x: 256, y: 192 };
/** Stable's spin cap and autoplay's spin rate (477 rpm), and Spun Out's (286 rpm), in radians per real ms. */
const MAX_SPIN = (477 / 60000) * Math.PI * 2;
const SPUNOUT_SPIN = (286 / 60000) * Math.PI * 2;
const HIT_FADE = 240;

interface Part {
  time: number;
  kind: 'tick' | 'repeat' | 'tail';
  span: number;
  /** Where on the path it is (0–1). */
  progress: number;
  done: boolean;
  hit: boolean;
}

interface GameObject {
  o: HitObject;
  index: number;
  start: number;
  end: number;
  pos: Vec2;
  endPos: Vec2;
  /** Stack offset of the slider path. */
  sh: number;
  comboNumber: number;
  newCombo: boolean;
  lastInCombo: boolean;
  colour: Rgb;
  /** Before the test's start: not played, not counted. */
  skipped: boolean;
  head: 'pending' | 'hit' | 'miss';
  headAt: number;
  shakeAt: number;
  judged: boolean;
  result: Judgement;
  judgedAt: number;
  sounds: SoundEvent[] | null;
  // sliders
  span: number;
  parts: Part[];
  partsHit: number;
  tracking: boolean;
  trackingAt: number;
  // spinners
  rotation: number;
  total: number;
  spins: number;
  required: number;
  bonus: number;
  bonusAt: number;
  clearedAt: number;
  lastAngle: number | null;
  rpm: number;
  spinLog: { at: number; total: number }[];
}

export interface Popup {
  pos: Vec2;
  time: number;
  value: Judgement;
  kind: 'geki' | 'katu' | null;
}

export interface ErrorMark {
  error: number;
  value: Judgement;
  at: number;
}

/** Stable's DifficultyRange: `min` at 0, `mid` at 5, `max` at 10. */
export function difficultyRange(v: number, min: number, mid: number, max: number): number {
  if (v > 5) return mid + ((max - mid) * (v - 5)) / 5;
  if (v < 5) return mid - ((mid - min) * (5 - v)) / 5;
  return mid;
}

export class StdGame {
  readonly bm: Beatmap;
  readonly proc: ProcessedBeatmap;
  readonly objs: GameObject[];
  readonly windows: { great: number; ok: number; meh: number };
  readonly radius: number;
  readonly rate: number;
  readonly auto: boolean;
  readonly cinema: boolean;
  readonly relax: boolean;
  readonly autopilot: boolean;
  readonly spunOut: boolean;
  readonly hidden: boolean;
  readonly flashlight: boolean;
  readonly v2: boolean;
  readonly breaks: BreakPeriod[];
  /** First object's start and last object's end (of the part being played). */
  readonly firstTime: number;
  readonly lastTime: number;
  readonly mapMaxCombo: number;
  private readonly canFail: boolean;
  private readonly suddenDeath: boolean;
  private readonly perfect: boolean;
  private readonly difficultyMultiplier: number;
  private readonly modMultiplier: number;
  private readonly maxComboPortion: number;
  private readonly judgeable: number;
  private readonly hp: number;
  private readonly test: boolean;

  scoreV1 = 0;
  private bonusScore = 0;
  private comboPortion = 0;
  private judgedCount = 0;
  combo = 0;
  maxCombo = 0;
  counts: Counts = { n300: 0, n100: 0, n50: 0, nMiss: 0, nGeki: 0, nKatu: 0 };
  health = 1;
  lives: number;
  failed = false;
  /** Every hit's error (ms), for the score meter and the ranking screen. */
  errors: ErrorMark[] = [];
  hpLog: number[] = [];
  cursor: Vec2 = { x: 256, y: 192 };
  /** K1, K2, M1, M2. */
  keys = [false, false, false, false];
  keyCounts = [0, 0, 0, 0];
  popups: Popup[] = [];
  trail: { pos: Vec2; at: number }[] = [];
  comboChangedAt = -Infinity;
  /** Whether the player's hits make the sounds (autoplay's are scheduled ahead instead, for exact timing). */
  playSounds: boolean;
  /** Snaking sliders, and the first object's approach circle under Hidden. */
  snaking = true;
  hiddenFirstApproach = true;

  private first = 0;
  private autoIdx = 0;
  private autoKey = 0;
  private lastT = -Infinity;
  private lastHpLog = -Infinity;
  private comboHad = { non300: false, bad: false };

  constructor(source: Beatmap, readonly mods: ModId[], opts: { startTime: number; test: boolean }) {
    this.bm = moddedBeatmap(source, mods);
    this.proc = processBeatmap(this.bm);
    const d = this.bm.difficulty;
    this.windows = hitWindows(d.overallDifficulty);
    this.radius = this.proc.radius;
    this.rate = rateOf(mods);
    this.auto = isAuto(mods);
    this.cinema = mods.includes('CN');
    this.relax = mods.includes('RX');
    this.autopilot = mods.includes('AP');
    this.spunOut = mods.includes('SO');
    this.hidden = mods.includes('HD');
    this.flashlight = mods.includes('FL');
    this.v2 = mods.includes('V2');
    this.suddenDeath = mods.includes('SD');
    this.perfect = mods.includes('PF');
    this.test = opts.test;
    this.canFail = !opts.test && !this.auto && !mods.includes('NF') && !this.relax && !this.autopilot;
    this.lives = mods.includes('EZ') ? 2 : 0;
    this.hp = d.hpDrainRate;
    this.playSounds = !this.auto;
    this.breaks = this.bm.events.breaks;

    const cols = comboColours(this.bm);
    const objects = this.bm.hitObjects;
    this.objs = objects.map((o, index) => {
      const info = this.proc.info.get(o.id)!;
      const start = o.time;
      const end = objectEndTime(this.bm, o);
      const g: GameObject = {
        o,
        index,
        start,
        end,
        pos: o.kind === 'spinner' ? SPINNER_CENTRE : stackedPosition(o, this.proc),
        endPos: o.kind === 'spinner' ? SPINNER_CENTRE : { x: info.endPos.x + info.stackHeight * this.proc.stackOffset, y: info.endPos.y + info.stackHeight * this.proc.stackOffset },
        sh: info.stackHeight * this.proc.stackOffset,
        comboNumber: info.comboNumber,
        newCombo: index === 0 || this.proc.info.get(objects[index].id)!.comboIndex !== this.proc.info.get(objects[index - 1].id)!.comboIndex,
        lastInCombo: false,
        colour: cols[comboColourIndex(o, this.proc, cols.length)],
        skipped: opts.test && start < opts.startTime,
        head: 'pending',
        headAt: 0,
        shakeAt: -Infinity,
        judged: false,
        result: 0,
        judgedAt: 0,
        sounds: null,
        span: 0,
        parts: [],
        partsHit: 0,
        tracking: false,
        trackingAt: 0,
        rotation: 0,
        total: 0,
        spins: 0,
        required: 0,
        bonus: 0,
        bonusAt: -Infinity,
        clearedAt: -Infinity,
        lastAngle: null,
        rpm: 0,
        spinLog: [],
      };
      if (g.skipped) g.judged = true;
      if (o.kind === 'slider') this.buildParts(g);
      if (o.kind === 'spinner') {
        const minRps = difficultyRange(d.overallDifficulty, 1.5, 2.5, 3.75);
        g.required = Math.max(1, Math.floor(((end - start) / 1000) * minRps));
      }
      return g;
    });
    this.objs.forEach((g, i) => (g.lastInCombo = i === this.objs.length - 1 || this.objs[i + 1].newCombo));

    const played = this.objs.filter((g) => !g.skipped);
    this.judgeable = played.length;
    this.firstTime = played[0]?.start ?? 0;
    this.lastTime = played.reduce((m, g) => Math.max(m, g.end), this.firstTime);

    // The best combo, and ScoreV2's combo portion for a perfect play.
    let combo = 0;
    let portion = 0;
    for (const g of played) {
      combo += g.o.kind === 'slider' ? g.parts.length + 1 : 1;
      portion += 300 * Math.sqrt(combo);
    }
    this.mapMaxCombo = combo;
    this.maxComboPortion = portion || 1;

    // ScoreV1's difficulty multiplier comes from the map's own settings, without mods.
    const sd = source.difficulty;
    const all = source.hitObjects;
    const breakTime = source.events.breaks.reduce((s, b) => s + (b.end - b.start), 0);
    const drain = all.length ? Math.max(1, (objectEndTime(source, all[all.length - 1]) - all[0].time - breakTime) / 1000) : 1;
    this.difficultyMultiplier = Math.round(((sd.hpDrainRate + sd.circleSize + sd.overallDifficulty + Math.max(0, Math.min(16, (all.length / drain) * 8))) / 38) * 5);
    this.modMultiplier = scoreMultiplier(mods);
  }

  private buildParts(g: GameObject) {
    const o = g.o as Extract<HitObject, { kind: 'slider' }>;
    const span = sliderSpanDuration(this.bm, o);
    g.span = span;
    const ticks = getSliderPath(o).length > 0 ? sliderTickProgresses(this.bm, o) : [];
    for (let i = 0; i < o.slides; i++) {
      const forward = i % 2 === 0;
      for (const p of ticks) g.parts.push({ time: g.start + span * (i + (forward ? p : 1 - p)), kind: 'tick', span: i, progress: p, done: false, hit: false });
      if (i < o.slides - 1) g.parts.push({ time: g.start + span * (i + 1), kind: 'repeat', span: i, progress: forward ? 1 : 0, done: false, hit: false });
    }
    g.parts.push({ time: Math.max(g.start + (g.end - g.start) / 2, g.end - TAIL_LENIENCY), kind: 'tail', span: o.slides - 1, progress: o.slides % 2 ? 1 : 0, done: false, hit: false });
    g.parts.sort((a, b) => a.time - b.time);
  }

  // ------------------------------------------------------------------ results

  get score(): number {
    if (!this.v2) return Math.round(this.scoreV1);
    const acc = this.accuracy;
    const progress = this.judgedCount / Math.max(1, this.judgeable);
    return Math.round((700000 * (this.comboPortion / this.maxComboPortion) + 300000 * acc ** 10 * progress) * this.modMultiplier + this.bonusScore);
  }

  get accuracy(): number {
    const c = this.counts;
    const total = c.n300 + c.n100 + c.n50 + c.nMiss;
    return total ? (c.n300 * 300 + c.n100 * 100 + c.n50 * 50) / (total * 300) : 1;
  }

  /** Every object has been judged. */
  get finished(): boolean {
    return this.objs.every((g) => g.judged);
  }

  inBreak(t: number): boolean {
    return this.breaks.some((b) => t >= b.start && t <= b.end);
  }

  // ------------------------------------------------------------------ input

  move(p: Vec2) {
    if (this.auto || this.autopilot) return;
    this.cursor = p;
  }

  press(slot: number, t: number) {
    if (this.keys[slot]) return;
    this.keys[slot] = true;
    if (this.auto) return;
    if (t >= this.firstTime - 2000 && !this.failed) this.keyCounts[slot]++;
    if (!this.relax && !this.failed) this.tryHit(t);
  }

  release(slot: number) {
    this.keys[slot] = false;
  }

  private get held(): boolean {
    return this.keys.some(Boolean);
  }

  private over(g: GameObject): boolean {
    return dist(this.cursor, g.pos) <= this.radius;
  }

  /** A click: the earliest object still waiting for its head takes it (notelock). */
  private tryHit(t: number) {
    let target: GameObject | null = null;
    let i = this.first;
    for (; i < this.objs.length; i++) {
      const g = this.objs[i];
      if (g.judged || g.o.kind === 'spinner' || g.head !== 'pending') continue;
      target = g;
      break;
    }
    if (!target) return;
    if (this.over(target)) {
      if (target.start - t > MISS_WINDOW) target.shakeAt = t;
      else this.hitHead(target, t);
      return;
    }
    // Clicking a later object while this one can still be hit shakes it, as stable's notelock does.
    for (let j = i + 1; j < this.objs.length; j++) {
      const g = this.objs[j];
      if (g.start - this.proc.preempt > t) break;
      if (!g.judged && g.o.kind !== 'spinner' && g.head === 'pending' && this.over(g)) {
        g.shakeAt = t;
        break;
      }
    }
  }

  private hitHead(g: GameObject, t: number) {
    const err = t - g.start;
    const w = this.windows;
    if (err > w.meh) return;
    if (err < -w.meh) {
      // Too early, but close enough to count: a miss.
      if (g.o.kind === 'circle') {
        g.head = 'miss';
        g.headAt = t;
        this.judge(g, 0, g.pos, t);
      } else this.missSliderHead(g, t);
      return;
    }
    const value: Judgement = Math.abs(err) <= w.great ? 300 : Math.abs(err) <= w.ok ? 100 : 50;
    this.errors.push({ error: err, value, at: performance.now() });
    g.head = 'hit';
    g.headAt = t;
    this.sound(g, g.start);
    if (g.o.kind === 'circle') {
      this.judge(g, value, g.pos, t);
      return;
    }
    // A slider's head: 30 points and a combo, whatever its timing.
    g.partsHit++;
    this.addCombo();
    this.scoreV1 += 30;
    this.heal(0.01);
  }

  private missSliderHead(g: GameObject, t: number) {
    g.head = 'miss';
    g.headAt = t;
    this.breakCombo();
    this.hurt(difficultyRange(this.hp, 0.015, 0.06, 0.1));
  }

  // ------------------------------------------------------------------ simulation

  /** Advances the game to song time t (ms). */
  update(t: number) {
    if (this.failed) return;
    const dt = Number.isFinite(this.lastT) ? Math.max(0, Math.min(100, t - this.lastT)) : 0;
    this.lastT = t;
    if (this.auto || this.autopilot) this.moveAuto(t);
    while (this.first < this.objs.length && this.objs[this.first].judged) this.first++;

    for (let i = this.first; i < this.objs.length; i++) {
      const g = this.objs[i];
      if (g.start - this.proc.preempt > t) break;
      if (g.judged) continue;
      if (g.head === 'pending' && g.o.kind !== 'spinner') {
        if (this.auto && t >= g.start) this.hitHead(g, g.start);
        else if (this.relax && t >= g.start && this.over(g)) this.hitHead(g, t);
      }
      if (g.o.kind === 'circle') {
        if (g.head === 'pending' && t > g.start + this.windows.meh) {
          g.head = 'miss';
          g.headAt = g.start + this.windows.meh;
          this.judge(g, 0, g.pos, t);
        }
      } else if (g.o.kind === 'slider') this.updateSlider(g, t);
      else if (g.o.kind === 'spinner') this.updateSpinner(g, t, dt);
    }

    // Health drains between the first and last objects, except in breaks.
    if (dt > 0 && t >= this.firstTime && t <= this.lastTime && !this.inBreak(t)) {
      this.hurt((difficultyRange(this.hp, 0.005, 0.02, 0.05) * dt) / 1000);
    }
    if (t - this.lastHpLog >= 250 && t >= this.firstTime && t <= this.lastTime) {
      this.lastHpLog = t;
      this.hpLog.push(this.health);
    }
    this.trail.push({ pos: { ...this.cursor }, at: performance.now() });
    while (this.trail.length > 24 || (this.trail.length && performance.now() - this.trail[0].at > 150)) this.trail.shift();
  }

  private ballAt(g: GameObject, t: number): Vec2 {
    const o = g.o as Extract<HitObject, { kind: 'slider' }>;
    const p = sliderPositionAtSpan(o, g.span > 0 ? Math.max(0, t - g.start) / g.span : 0);
    return { x: p.x + g.sh, y: p.y + g.sh };
  }

  private updateSlider(g: GameObject, t: number) {
    if (g.head === 'pending' && t > g.start + this.windows.meh) this.missSliderHead(g, g.start + this.windows.meh);
    if (t >= g.start) {
      const ball = this.ballAt(g, Math.min(t, g.end));
      const reach = this.radius * (g.tracking ? 2.4 : 1);
      const tracking = t <= g.end && (this.held || this.relax || this.auto) && dist(this.cursor, ball) <= reach;
      if (tracking !== g.tracking) {
        g.tracking = tracking;
        g.trackingAt = t;
        if (this.playSounds) {
          if (tracking) objectSustainedSounds(this.bm, g.o)[0]?.play(0, t - g.start, this.rate);
          else hitsounds.stopLoops();
        }
      }
    }
    for (const p of g.parts) {
      if (p.done || p.time > t) continue;
      p.done = true;
      if (g.tracking) {
        p.hit = true;
        g.partsHit++;
        this.addCombo();
        this.scoreV1 += p.kind === 'tick' ? 10 : 30;
        this.heal(p.kind === 'tick' ? 0.01 : 0.02);
        // The tail sounds at the slider's real end.
        if (p.kind === 'tail') this.sound(g, g.end, (g.end - t) / this.rate / 1000);
        else this.sound(g, p.time);
      } else if (p.kind !== 'tail') {
        // A slider break; dropping only the tail doesn't break the combo.
        this.breakCombo();
        this.hurt(difficultyRange(this.hp, 0.015, 0.06, 0.1));
      }
    }
    if (t >= g.end && g.parts.every((p) => p.done)) {
      if (g.tracking && this.playSounds) hitsounds.stopLoops();
      g.tracking = false;
      const ratio = g.partsHit / (g.parts.length + 1);
      const value: Judgement = ratio >= 1 ? 300 : ratio >= 0.5 ? 100 : ratio > 0 ? 50 : 0;
      this.judge(g, value, g.endPos, t, false);
    }
  }

  private updateSpinner(g: GameObject, t: number, dt: number) {
    if (t >= g.start && t <= g.end) {
      const real = dt / this.rate;
      let delta = 0;
      if (this.auto || this.spunOut || this.autopilot) {
        delta = (this.auto ? MAX_SPIN : SPUNOUT_SPIN) * real;
        g.lastAngle = null;
      } else if (this.held || this.relax) {
        const a = Math.atan2(this.cursor.y - SPINNER_CENTRE.y, this.cursor.x - SPINNER_CENTRE.x);
        if (g.lastAngle !== null) {
          let d = a - g.lastAngle;
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          delta = Math.sign(d) * Math.min(Math.abs(d), MAX_SPIN * real);
        }
        g.lastAngle = a;
      } else g.lastAngle = null;
      g.rotation += delta;
      g.total += Math.abs(delta);
      const now = performance.now();
      g.spinLog.push({ at: now, total: g.total });
      while (g.spinLog.length > 2 && now - g.spinLog[0].at > 500) g.spinLog.shift();
      const span = (now - g.spinLog[0].at) / 1000;
      if (span > 0.05) g.rpm = ((g.total - g.spinLog[0].total) / (Math.PI * 2) / span) * 60;
      while (g.total >= (g.spins + 1) * Math.PI * 2) {
        g.spins++;
        if (g.spins <= g.required) {
          this.scoreV1 += 100;
          this.heal(0.004);
          if (g.spins === g.required) g.clearedAt = t;
        } else {
          g.bonus++;
          g.bonusAt = t;
          this.scoreV1 += 1000;
          this.bonusScore += 1000;
          if (this.playSounds || this.auto) hitsounds.playGame('spinnerbonus', 0.8);
        }
      }
    }
    if (t > g.end) {
      const ratio = g.spins / g.required;
      const value: Judgement = ratio >= 1 ? 300 : ratio >= 0.9 ? 100 : ratio >= 0.75 ? 50 : 0;
      if (value > 0) this.sound(g, g.end);
      this.judge(g, value, SPINNER_CENTRE, t);
    }
  }

  /** Autoplay and Autopilot: the cursor glides from object to object, follows sliders and circles in spinners. */
  private moveAuto(t: number) {
    const objs = this.objs;
    while (this.autoIdx < objs.length - 1 && (objs[this.autoIdx].end < t || objs[this.autoIdx].skipped)) this.autoIdx++;
    const g = objs[this.autoIdx];
    if (!g) return;
    const spinPos = (s: GameObject) => ({ x: SPINNER_CENTRE.x + Math.cos(s.rotation) * 50, y: SPINNER_CENTRE.y + Math.sin(s.rotation) * 50 });
    if (t >= g.start) {
      if (g.o.kind === 'slider') this.cursor = this.ballAt(g, Math.min(t, g.end));
      else if (g.o.kind === 'spinner') this.cursor = spinPos(g);
      else this.cursor = g.pos;
    } else {
      const prev = this.autoIdx > 0 && !objs[this.autoIdx - 1].skipped ? objs[this.autoIdx - 1] : null;
      const from = prev ? (prev.o.kind === 'spinner' ? spinPos(prev) : prev.endPos) : this.cursor;
      const to = g.o.kind === 'spinner' ? { x: SPINNER_CENTRE.x + 50, y: SPINNER_CENTRE.y } : g.pos;
      const t0 = prev ? prev.end : t - 1;
      const k = Math.min(1, Math.max(0, (t - t0) / Math.max(1, g.start - t0)));
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      if (prev || k > 0) this.cursor = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
    }
    if (this.auto) {
      // Alternate K1/K2 like stable's autoplay, holding through sliders and spinners.
      const active = t >= g.start - 5 && t <= g.end + 50;
      if (active && !this.keys[0] && !this.keys[1]) {
        this.autoKey ^= 1;
        this.keys[this.autoKey] = true;
        this.keyCounts[this.autoKey]++;
      } else if (!active) this.keys = [false, false, false, false];
    }
  }

  // ------------------------------------------------------------------ scoring

  private sound(g: GameObject, time: number, delay = 0) {
    if (!this.playSounds) return;
    g.sounds ??= objectSoundEvents(this.bm, g.o);
    const e = g.sounds.find((s) => Math.abs(s.time - time) < 1);
    e?.play(Math.max(0, delay));
  }

  private addCombo() {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboChangedAt = performance.now();
  }

  private breakCombo() {
    if (this.combo >= 20) hitsounds.playGame('combobreak');
    if (this.combo > 0) this.comboChangedAt = performance.now();
    this.combo = 0;
    if (this.suddenDeath || this.perfect) this.fail();
  }

  private heal(amount: number) {
    // Higher HP drain gives less back per hit.
    this.health = Math.min(1, this.health + amount * (1 - this.hp / 20));
  }

  private hurt(amount: number) {
    this.health -= amount;
    if (this.health > 0) return;
    this.health = 0;
    if (!this.canFail) return;
    if (this.lives > 0) {
      // Easy's extra lives.
      this.lives--;
      this.health = 1;
      return;
    }
    this.fail();
  }

  /** Sudden Death and Perfect fail even with No Fail's friends; test mode and autoplay never do. */
  private fail() {
    if (this.failed || this.auto || this.test) return;
    if (!this.canFail && !(this.suddenDeath || this.perfect)) return;
    this.failed = true;
    hitsounds.stopLoops();
  }

  private judge(g: GameObject, value: Judgement, pos: Vec2, t: number, addsCombo = true) {
    g.judged = true;
    g.result = value;
    g.judgedAt = t;
    this.judgedCount++;
    const c = this.counts;
    if (value === 300) c.n300++;
    else if (value === 100) c.n100++;
    else if (value === 50) c.n50++;
    else c.nMiss++;
    if (value === 0) {
      this.breakCombo();
      this.hurt(difficultyRange(this.hp, 0.03, 0.125, 0.2));
    } else {
      const before = this.combo;
      if (addsCombo) this.addCombo();
      this.scoreV1 += value + Math.floor((value * Math.max(0, before - 1) * this.difficultyMultiplier * this.modMultiplier) / 25);
      this.comboPortion += value * Math.sqrt(Math.max(1, this.combo));
      this.heal(value === 300 ? 0.04 : value === 100 ? 0.012 : 0);
      if (this.perfect && value !== 300) this.fail();
    }
    // 激 and 喝 at the end of a combo.
    if (value !== 300) this.comboHad.non300 = true;
    if (value === 50 || value === 0) this.comboHad.bad = true;
    let kind: Popup['kind'] = null;
    if (g.lastInCombo) {
      if (value !== 0 && !this.comboHad.bad) {
        if (!this.comboHad.non300) {
          kind = 'geki';
          c.nGeki++;
          this.heal(0.05);
        } else if (value === 300 || value === 100) {
          kind = 'katu';
          c.nKatu++;
          this.heal(0.02);
        }
      }
      this.comboHad = { non300: false, bad: false };
    }
    this.popups.push({ pos, time: t, value, kind });
    if (this.popups.length > 40) this.popups.shift();
  }

  // ------------------------------------------------------------------ drawing

  private appearAlpha(g: GameObject, t: number): number {
    const preempt = this.proc.preempt;
    const appear = g.start - preempt;
    if (!this.hidden) return Math.max(0, Math.min(1, (t - appear) / this.proc.fadeIn));
    const fadeIn = preempt * 0.4;
    if (t < appear + fadeIn) return Math.max(0, (t - appear) / fadeIn);
    return Math.max(0, Math.min(1, 1 - (t - (g.start - preempt * 0.6)) / (preempt * 0.3)));
  }

  draw(ctx: CanvasRenderingContext2D, v: View, t: number) {
    if (this.cinema) return;
    const preempt = this.proc.preempt;
    // Objects judged in the last moments sit just before `first`, still animating.
    const shown: GameObject[] = [];
    for (let i = Math.max(0, this.first - 40); i < this.objs.length; i++) {
      const g = this.objs[i];
      if (g.start - preempt > t) break;
      if (!g.skipped && t <= Math.max(g.end, g.judgedAt) + 700) shown.push(g);
    }

    // Follow points between the objects of a combo, eaten as time passes.
    const R = this.radius * v.scale;
    for (let i = 0; i < this.objs.length - 1; i++) {
      const a = this.objs[i];
      const b = this.objs[i + 1];
      if (b.start - preempt > t) break;
      if (a.skipped || b.newCombo || a.o.kind === 'spinner' || b.o.kind === 'spinner' || t > b.start || t < a.end - preempt) continue;
      const k = Math.max(0, (t - a.end) / Math.max(1, b.start - a.end));
      const from = { x: a.endPos.x + (b.pos.x - a.endPos.x) * k, y: a.endPos.y + (b.pos.y - a.endPos.y) * k };
      const alpha = Math.min(1, (t - (a.end - preempt)) / 300);
      drawFollowPoints(ctx, toScreen(v, k > 0 ? from : a.endPos), toScreen(v, b.pos), R, alpha * 0.8);
    }

    for (let i = shown.length - 1; i >= 0; i--) {
      const g = shown[i];
      if (g.o.kind === 'spinner') this.drawSpinner(ctx, v, g, t);
      else if (g.o.kind === 'slider') this.drawSlider(ctx, v, g, t);
      else this.drawHead(ctx, v, g, t);
    }
    this.drawPopups(ctx, v, t);
  }

  private drawHead(ctx: CanvasRenderingContext2D, v: View, g: GameObject, t: number) {
    const R = this.radius * v.scale;
    let p = toScreen(v, g.pos);
    const shake = t - g.shakeAt;
    if (shake >= 0 && shake < 150) p = { x: p.x + Math.sin(shake / 12) * 6 * v.scale * (1 - shake / 150), y: p.y };
    const label = String(g.comboNumber);
    if (g.head === 'pending') {
      const alpha = this.appearAlpha(g, t);
      drawHitCircle(ctx, p.x, p.y, R, g.colour, alpha, label, false);
      const approach = !this.hidden || (this.hiddenFirstApproach && g.index === this.objs.findIndex((x) => !x.skipped));
      if (t < g.start && approach) {
        const prog = (g.start - t) / this.proc.preempt;
        drawApproachCircle(ctx, p.x, p.y, R * (1 + 3 * prog), g.colour, Math.min(1, ((t - (g.start - this.proc.preempt)) / this.proc.fadeIn) * 0.9));
      }
      return;
    }
    const age = t - g.headAt;
    if (g.head === 'hit' && age < HIT_FADE) {
      drawHitCircle(ctx, p.x, p.y, R * (1 + 0.4 * (age / HIT_FADE)), g.colour, (1 - age / HIT_FADE) * (this.hidden ? 0.5 : 1), label, false);
    } else if (g.head === 'miss' && age < 100) {
      drawHitCircle(ctx, p.x, p.y, R, g.colour, (1 - age / 100) * this.appearAlpha(g, g.start), label, false);
    }
  }

  private drawSlider(ctx: CanvasRenderingContext2D, v: View, g: GameObject, t: number) {
    const o = g.o as Extract<HitObject, { kind: 'slider' }>;
    const R = this.radius * v.scale;
    const path = getSliderPath(o);
    const preempt = this.proc.preempt;
    const appear = g.start - preempt;
    const toS = (q: Vec2) => toScreen(v, { x: q.x + g.sh, y: q.y + g.sh });
    let alpha: number;
    if (this.hidden) {
      const fadeIn = preempt * 0.4;
      const from = appear + fadeIn;
      alpha = t < from ? Math.max(0, (t - appear) / fadeIn) : Math.max(0, 1 - (t - from) / Math.max(1, g.end - from));
    } else {
      alpha = Math.min(1, Math.max(0, (t - appear) / this.proc.fadeIn));
      if (t > g.end) alpha *= Math.max(0, 1 - (t - g.end) / 200);
    }
    if (alpha > 0) {
      const snake = this.snaking && t < g.start ? Math.min(1, Math.max(0, (t - appear) / (preempt / 3))) : 1;
      const pts = (snake < 1 ? path.pathBetween(0, snake) : path.points).map(toS);
      const { track, border } = sliderColours(this.bm, g.colour);
      drawSliderBody(ctx, pts, R, track, border, alpha * 0.9, false, path);

      const spanNow = t < g.start ? 0 : Math.min(o.slides - 1, Math.floor((t - g.start) / Math.max(1, g.span)));
      // End circles where a span still to come finishes (even spans end at the far end), the last one fading with the body.
      const moreSpans = spanNow < o.slides - 1;
      if (moreSpans || spanNow % 2 === 1) drawSliderEndCircle(ctx, pts[0].x, pts[0].y, R, g.colour, alpha);
      if (snake >= 1 && (moreSpans || spanNow % 2 === 0)) drawSliderEndCircle(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y, R, g.colour, alpha);
      if (t <= g.end) {
        for (const p of g.parts) {
          if (p.kind !== 'tick' || p.done || p.span !== spanNow || (snake < 1 && p.progress > snake)) continue;
          const q = toS(path.positionAt(p.progress));
          drawSliderTick(ctx, q.x, q.y, R, alpha);
        }
        // Reverse arrows at the end of the current span (and the far end when another repeat follows).
        const endPt = pts[pts.length - 1];
        const startPt = pts[0];
        const nearEnd = pts[Math.max(0, pts.length - 2)];
        const nearStart = pts[Math.min(pts.length - 1, 1)];
        if (snake >= 1 && spanNow < o.slides - 1) {
          const atEnd = spanNow % 2 === 0;
          drawReverseArrow(ctx, atEnd ? endPt : startPt, atEnd ? nearEnd : nearStart, R, alpha);
          if (spanNow + 1 < o.slides - 1) drawReverseArrow(ctx, atEnd ? startPt : endPt, atEnd ? nearStart : nearEnd, R, alpha);
        }
      }
      if (t >= g.start && t <= g.end && g.span > 0) {
        const at = (t - g.start) / g.span;
        const b = sliderPositionAtSpan(o, at);
        const n = sliderPositionAtSpan(o, Math.min(o.slides, at + 0.02));
        const follow = g.tracking ? Math.min(1, 0.5 + (t - g.trackingAt) / 360) : 0;
        drawSliderBall(ctx, toS(b), Math.atan2(n.y - b.y, n.x - b.x), R, g.colour, 1, follow);
      }
    }
    this.drawHead(ctx, v, g, t);
  }

  private drawSpinner(ctx: CanvasRenderingContext2D, v: View, g: GameObject, t: number) {
    const fadeStart = g.start - Math.min(this.proc.preempt, 400);
    let alpha = Math.min(1, Math.max(0, (t - fadeStart) / Math.max(1, g.start - fadeStart)));
    if (t > g.end) alpha *= Math.max(0, 1 - (t - g.end) / 200);
    if (alpha <= 0) return;
    const c = toScreen(v, SPINNER_CENTRE);
    const skin = skins.current;
    const k = 0.625 * v.scale;
    const progress = Math.min(1, g.spins / g.required + (g.total / (Math.PI * 2) - g.spins) / g.required);
    const remaining = t < g.start ? 1 : Math.max(0, 1 - (t - g.start) / Math.max(1, g.end - g.start));
    ctx.save();
    ctx.globalAlpha = alpha;
    const bottom = skin?.get('spinner-bottom');
    const top = skin?.get('spinner-top');
    const glow = skin?.get('spinner-glow');
    const middle2 = skin?.get('spinner-middle2');
    const middle = skin?.get('spinner-middle');
    const old = skin?.get('spinner-circle');
    if (bottom || top || old) {
      if (glow) {
        ctx.globalAlpha = alpha * progress;
        drawTexture(ctx, skin!.tinted('spinner-glow', { r: 3, g: 151, b: 255 }) ?? glow, c.x, c.y, k);
        ctx.globalAlpha = alpha;
      }
      if (bottom) drawTexture(ctx, bottom, c.x, c.y, k, g.rotation / 3);
      if (top) drawTexture(ctx, top, c.x, c.y, k, g.rotation);
      if (old && !bottom && !top) drawTexture(ctx, old, c.x, c.y, k, g.rotation);
      if (middle2) drawTexture(ctx, middle2, c.x, c.y, k);
      if (middle) drawTexture(ctx, skin!.tinted('spinner-middle', { r: 255, g: Math.round(255 * (1 - progress)), b: Math.round(255 * (1 - progress)) }) ?? middle, c.x, c.y, k);
      const approach = skin?.get('spinner-approachcircle');
      if (approach && t >= g.start && remaining > 0) drawTexture(ctx, approach, c.x, c.y, ((2 * 190 * v.scale) / approach.w) * remaining);
    } else {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 190 * v.scale * remaining + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(102,204,255,0.9)';
      ctx.lineWidth = 8 * v.scale;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 60 * v.scale, -Math.PI / 2 + g.rotation, -Math.PI / 2 + g.rotation + Math.PI * 2 * progress);
      ctx.stroke();
    }
    // "Spin!" at the start, "Clear!" once it's done, the bonus and the RPM.
    const spinTex = skin?.get('spinner-spin');
    if (spinTex && t >= g.start - 200 && t < g.start + 800 && g.spins < g.required) drawTexture(ctx, spinTex, c.x, c.y + 120 * v.scale, k);
    const clearTex = skin?.get('spinner-clear');
    const sinceClear = t - g.clearedAt;
    if (sinceClear >= 0 && t <= g.end + 200) {
      const pop = sinceClear < 150 ? 1.6 - (0.6 * sinceClear) / 150 : 1;
      if (clearTex) drawTexture(ctx, clearTex, c.x, c.y - 100 * v.scale, k * pop);
      else drawText(ctx, 'Clear!', c.x, c.y - 100 * v.scale, 36 * v.scale * pop);
    }
    if (g.bonus > 0 && t - g.bonusAt < 800) {
      ctx.globalAlpha = alpha * (1 - (t - g.bonusAt) / 800);
      drawGlyphs(ctx, 'score', String(g.bonus * 1000), c.x, c.y + 70 * v.scale, 0.8 * v.scale, 'center');
      ctx.globalAlpha = alpha;
    }
    if (t >= g.start) drawText(ctx, `RPM: ${Math.round(g.rpm)}`, c.x, c.y + 205 * v.scale, 16 * v.scale);
    ctx.restore();
  }

  private drawPopups(ctx: CanvasRenderingContext2D, v: View, t: number) {
    const skin = skins.current;
    for (const p of this.popups) {
      const age = t - p.time;
      const life = p.value === 0 ? 800 : 600;
      if (age < 0 || age > life) continue;
      if (this.cinema) continue;
      let pos = toScreen(v, p.pos);
      const name = p.value === 300 ? (p.kind === 'geki' ? 'hit300g' : p.kind === 'katu' ? 'hit300k' : 'hit300') : p.value === 100 ? (p.kind === 'katu' ? 'hit100k' : 'hit100') : p.value === 50 ? 'hit50' : 'hit0';
      const tex = skin?.get(name) ?? (name.length > 6 ? skin?.get(name.slice(0, 6)) : undefined);
      const alpha = Math.min(1, (life - age) / 200);
      let scale = age < 100 ? 0.7 + (0.3 * age) / 100 : 1;
      let rot = 0;
      if (p.value === 0) {
        pos = { x: pos.x, y: pos.y + (age / life) ** 2 * 40 * v.scale };
        rot = (age / life) * 0.3;
        scale = 1;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      if (tex) drawTexture(ctx, tex, pos.x, pos.y, 0.625 * v.scale * scale, rot);
      else {
        ctx.fillStyle = p.value === 300 ? '#66ccff' : p.value === 100 ? '#88ff66' : p.value === 50 ? '#ffcc44' : '#ff4444';
        drawText(ctx, p.value === 0 ? '✕' : String(p.value), pos.x, pos.y, 22 * v.scale * scale, ctx.fillStyle as string);
      }
      ctx.restore();
    }
  }

  /** The cursor and its trail, `size` screen pixels per skin pixel. */
  drawCursor(ctx: CanvasRenderingContext2D, v: View, size: number) {
    const skin = skins.current;
    const pressed = this.keys.some(Boolean) && !this.auto ? 1.15 : 1;
    const trailTex = skin?.get('cursortrail');
    const now = performance.now();
    if (trailTex) {
      for (const p of this.trail) {
        const age = (now - p.at) / 150;
        if (age >= 1) continue;
        ctx.save();
        ctx.globalAlpha = (1 - age) * 0.6;
        const s = toScreen(v, p.pos);
        drawTexture(ctx, trailTex, s.x, s.y, size);
        ctx.restore();
      }
    }
    const c = toScreen(v, this.cursor);
    const cursor = skin?.get('cursor');
    if (cursor) {
      drawTexture(ctx, cursor, c.x, c.y, size * pressed);
      const middle = skin?.get('cursormiddle');
      if (middle) drawTexture(ctx, middle, c.x, c.y, size);
      return;
    }
    ctx.save();
    ctx.fillStyle = '#ffd400';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12 * size * 1.6 * pressed, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Flashlight: darkness except around the cursor, smaller at 100 and 200 combo. */
  drawFlashlight(ctx: CanvasRenderingContext2D, v: View, w: number, h: number, t: number) {
    if (!this.flashlight || this.inBreak(t)) return;
    const c = toScreen(v, this.cursor);
    const r = (this.combo < 100 ? 200 : this.combo < 200 ? 170 : 140) * v.scale;
    const g = ctx.createRadialGradient(c.x, c.y, r * 0.75, c.x, c.y, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ text helpers (also used by the HUD)

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, colour = '#fff', align: CanvasTextAlign = 'center') {
  ctx.save();
  ctx.font = `600 ${Math.round(size)}px Ubuntu, system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = size * 0.15;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * Text in the skin's score or combo font (falls back to plain text), `k` screen pixels per skin pixel, anchored by its
 * vertical middle. Returns the drawn width.
 */
export function drawGlyphs(ctx: CanvasRenderingContext2D, font: 'score' | 'combo', text: string, x: number, y: number, k: number, align: 'left' | 'right' | 'center'): number {
  const skin = skins.current;
  const glyphs = skin ? [...text].map((ch) => skin.glyph(font, ch)) : [];
  if (!skin || glyphs.some((g) => !g)) {
    const size = 46 * k;
    ctx.save();
    ctx.font = `700 ${Math.round(size)}px Ubuntu, system-ui, sans-serif`;
    const w = ctx.measureText(text).width;
    ctx.restore();
    drawText(ctx, text, align === 'left' ? x : align === 'right' ? x - w : x - w / 2, y, size, '#fff', 'left');
    return w;
  }
  const overlap = skin.overlap(font);
  const total = (glyphs as Texture[]).reduce((s, g) => s + g.w, 0) - overlap * (glyphs.length - 1);
  let cx = align === 'left' ? x : align === 'right' ? x - total * k : x - (total * k) / 2;
  for (const g of glyphs as Texture[]) {
    ctx.drawImage(g.image, cx, y - (g.h * k) / 2, g.w * k, g.h * k);
    cx += (g.w - overlap) * k;
  }
  return total * k;
}

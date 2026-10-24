// Hitsound sample bank and playback through Web Audio.
import { getSliderPath } from '../osu/curves';
import { sliderTickProgresses } from '../osu/processing';
import { controlPointAt, sliderSpanDuration } from '../osu/timing';
import { HitSound, type Beatmap, type HitObject, type SampleSet } from '../osu/types';

const SET_NAMES = ['normal', 'normal', 'soft', 'drum'];
const DEFAULT_SAMPLE_NAMES = ['hitnormal', 'hitwhistle', 'hitfinish', 'hitclap', 'slidertick', 'sliderslide', 'sliderwhistle'];

class HitsoundEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private defaults = new Map<string, AudioBuffer>();
  private custom = new Map<string, AudioBuffer>();
  private loadingDefaults: Promise<void> | null = null;
  volume = 0.8;
  enabled = true;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Must be called from a user gesture at least once so the AudioContext can start. */
  unlock() {
    this.ensureCtx();
    void this.loadDefaults();
  }

  loadDefaults(): Promise<void> {
    if (this.loadingDefaults) return this.loadingDefaults;
    const ctx = this.ensureCtx();
    const jobs: Promise<void>[] = [];
    for (const set of ['normal', 'soft', 'drum']) {
      for (const name of DEFAULT_SAMPLE_NAMES) {
        const key = `${set}-${name}`;
        jobs.push(
          fetch(`/samples/${key}.wav`)
            .then((r) => r.arrayBuffer())
            .then((b) => ctx.decodeAudioData(b))
            .then((buf) => void this.defaults.set(key, buf))
            .catch(() => undefined),
        );
      }
    }
    this.loadingDefaults = Promise.all(jobs).then(() => undefined);
    return this.loadingDefaults;
  }

  /** Decode beatmap-provided samples (e.g. soft-hitclap2.wav). Keys are lower-case names without extension. */
  async setCustomSamples(files: Map<string, Blob>, mainAudio: string) {
    const ctx = this.ensureCtx();
    this.custom.clear();
    const jobs: Promise<void>[] = [];
    for (const [name, blob] of files) {
      if (!/\.(wav|ogg|mp3)$/i.test(name)) continue;
      if (name.toLowerCase() === mainAudio.toLowerCase()) continue;
      if (blob.size > 4 * 1024 * 1024) continue;
      jobs.push(
        blob
          .arrayBuffer()
          .then((b) => ctx.decodeAudioData(b))
          .then((buf) => {
            const lower = name.toLowerCase().replace(/\\/g, '/');
            this.custom.set(lower, buf);
            this.custom.set(lower.replace(/\.(wav|ogg|mp3)$/, ''), buf);
          })
          .catch(() => undefined),
      );
    }
    await Promise.all(jobs);
  }

  private lookup(set: string, name: string, index: number): AudioBuffer | undefined {
    if (index > 1) {
      const c = this.custom.get(`${set}-${name}${index}`);
      if (c) return c;
    }
    if (index === 1) {
      const c = this.custom.get(`${set}-${name}`);
      if (c) return c;
    }
    return this.defaults.get(`${set}-${name}`);
  }

  playBuffer(buf: AudioBuffer | undefined, volume: number, when = 0, rate = 1) {
    if (!buf || !this.enabled) return;
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(g).connect(this.master!);
    src.start(when > 0 ? ctx.currentTime + when : 0);
  }

  /** Play a set of hitsounds for the given resolved sample settings. */
  playHit(
    bm: Beatmap,
    time: number,
    hitSound: number,
    normalSet: SampleSet,
    additionSet: SampleSet,
    index: number,
    volume: number,
    filename = '',
    delay = 0,
  ) {
    const tp = controlPointAt(bm, time);
    const defaultSet = bm.general.sampleSet === 'Normal' ? 1 : bm.general.sampleSet === 'Drum' ? 3 : 2;
    const ns = normalSet || tp.sampleSet || defaultSet;
    const as = additionSet || ns;
    const idx = index || tp.sampleIndex;
    const vol = (volume || tp.volume) / 100;
    if (filename) {
      this.playBuffer(this.custom.get(filename.toLowerCase()), vol, delay);
      return;
    }
    this.playBuffer(this.lookup(SET_NAMES[ns], 'hitnormal', idx), vol, delay);
    if (hitSound & HitSound.Whistle) this.playBuffer(this.lookup(SET_NAMES[as], 'hitwhistle', idx), vol, delay);
    if (hitSound & HitSound.Finish) this.playBuffer(this.lookup(SET_NAMES[as], 'hitfinish', idx), vol, delay);
    if (hitSound & HitSound.Clap) this.playBuffer(this.lookup(SET_NAMES[as], 'hitclap', idx), vol, delay);
  }

  playTick(bm: Beatmap, time: number, normalSet: SampleSet, index: number, volume: number, delay = 0) {
    const tp = controlPointAt(bm, time);
    const defaultSet = bm.general.sampleSet === 'Normal' ? 1 : bm.general.sampleSet === 'Drum' ? 3 : 2;
    const ns = normalSet || tp.sampleSet || defaultSet;
    const idx = index || tp.sampleIndex;
    this.playBuffer(this.lookup(SET_NAMES[ns], 'slidertick', idx), (volume || tp.volume) / 100, delay);
  }

  /** Play a beatmap file by name (storyboard samples). */
  playFile(name: string, volume: number, delay = 0) {
    const key = name.toLowerCase().replace(/\\/g, '/');
    this.playBuffer(this.custom.get(key) ?? this.custom.get(key.replace(/\.(wav|ogg|mp3)$/, '')), volume, delay);
  }

  playMetronome(accent: boolean) {
    const ctx = this.ensureCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(g).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }
}

export const hitsounds = new HitsoundEngine();

export interface SoundEvent {
  time: number;
  play: (delay: number) => void;
}

/** Every sound an object makes over its lifetime (head, ticks, repeats, tail). */
export function objectSoundEvents(bm: Beatmap, o: HitObject): SoundEvent[] {
  const s = o.sample;
  if (o.kind === 'circle') {
    return [{ time: o.time, play: (d) => hitsounds.playHit(bm, o.time, o.hitSound, s.normalSet, s.additionSet, s.index, s.volume, s.filename, d) }];
  }
  if (o.kind === 'spinner' || o.kind === 'hold') {
    const t = o.kind === 'hold' ? o.time : o.endTime;
    return [{ time: t, play: (d) => hitsounds.playHit(bm, t, o.hitSound, s.normalSet, s.additionSet, s.index, s.volume, s.filename, d) }];
  }
  const events: SoundEvent[] = [];
  const span = sliderSpanDuration(bm, o);
  const ticks = getSliderPath(o).length > 0 ? sliderTickProgresses(bm, o) : [];
  for (let i = 0; i <= o.slides; i++) {
    const t = o.time + span * i;
    const set = o.edgeSets[i] ?? { normal: 0, addition: 0 };
    const hs = o.edgeSounds[i] ?? 0;
    const ns = (set.normal || s.normalSet) as SampleSet;
    const as = (set.addition || s.additionSet) as SampleSet;
    events.push({ time: t, play: (d) => hitsounds.playHit(bm, t, hs, ns, as, s.index, s.volume, '', d) });
    if (i < o.slides) {
      for (const p of ticks) {
        const tt = o.time + span * (i + (i % 2 === 0 ? p : 1 - p));
        events.push({ time: tt, play: (d) => hitsounds.playTick(bm, tt, s.normalSet, s.index, s.volume, d) });
      }
    }
  }
  return events;
}

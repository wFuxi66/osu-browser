// Playing a map: song select's Play (with the selected mods, local scores and the ranking screen) and the editor's F5
// test mode (from the current time, never failing, Esc back to the editor). osu!standard is fully playable; the other
// modes run as an autoplay preview.
import { useEffect, useRef, useState } from 'react';
import { hitsounds } from '../audio/hitsounds';
import { music } from '../audio/music';
import { dist } from '../osu/curves';
import { serializeBeatmap } from '../osu/serializer';
import type { Vec2 } from '../osu/types';
import { checksumOf, findFile, uid } from '../project/project';
import { cloud } from '../project/cloud';
import { comboOf, keysFor } from '../editor/keybinds';
import { onFrame, scheduling } from '../editor/playback';
import { CatchMode } from '../editor/playfield/catchMode';
import { ManiaMode } from '../editor/playfield/maniaMode';
import { TaikoMode } from '../editor/playfield/taikoMode';
import { toOsu, toScreen, type View } from '../editor/render/draw';
import { layoutCode } from '../editor/shortcuts';
import { editor, PLAYFIELD_H, PLAYFIELD_W, useEditor } from '../editor/store';
import { drawBackground } from '../editor/ui/Playfield';
import { skins, textureUrl } from '../skin/skin';
import { canvasDpr } from '../ui/touch';
import { Hud, type BoardEntry } from './hud';
import { ModIcon } from './ModIcon';
import { isAuto, modSelection, modsLabel, rateOf, useMods, withMod, type ModId } from './mods';
import { Results } from './Results';
import { errorStats, gradeOf, scores, type Score } from './scores';
import { gameplay } from './session';
import { StdGame } from './stdGame';

type Phase = 'playing' | 'paused' | 'resuming' | 'failed' | 'results';

interface Controls {
  pause: () => void;
  resume: () => void;
  skip: () => void;
}

/** Test mode's quick mod toggles. */
const TEST_MODS: ModId[] = ['AU', 'HT', 'DT', 'EZ', 'HR', 'HD', 'FL'];

function downsample(v: number[], n: number): number[] {
  if (v.length <= n) return v.map((x) => Math.round(x * 1000) / 1000);
  return Array.from({ length: n }, (_, i) => Math.round(v[Math.floor((i * (v.length - 1)) / (n - 1))] * 1000) / 1000);
}

export function Player({ mode }: { mode: 'play' | 'test' }) {
  useEditor();
  const selected = useMods(mode);
  // Ctrl+Enter's Autoplay is for this play (and its retries) only.
  const [override] = useState(() => {
    const o = mode === 'play' ? gameplay.modsOverride : null;
    gameplay.modsOverride = null;
    return o;
  });
  const mods = override ?? selected;
  const ref = useRef<HTMLCanvasElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>('playing');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [skipShown, setSkipShown] = useState(false);
  const [result, setResult] = useState<{ score: Score; saved: boolean } | null>(null);
  const [preview, setPreview] = useState(false);
  const controls = useRef<Controls | null>(null);
  /** Where the editor was when the test started; the test starts there and goes back there. */
  const testStart = useRef(music.time);
  /** The editor's playback rate (25–75%), restored after a test. */
  const editorRate = useRef(music.rate);
  const bg = useBackgroundUrl();

  const quit = () => {
    if (mode === 'test') {
      music.pause();
      music.seek(testStart.current);
      editor.openDialog(null);
    } else editor.closeProject();
  };
  const retry = () => {
    setResult(null);
    setPhase('playing');
    setAttempt((a) => a + 1);
  };

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    const prefs = editor.prefs;
    const src = editor.bm;
    const std = src.general.mode === 0;
    const test = mode === 'test';
    const game = std ? new StdGame(src, mods, { startTime: testStart.current, test }) : null;
    if (game) {
      game.snaking = prefs.playSnaking;
      game.hiddenFirstApproach = prefs.hiddenFirstApproach;
    }
    const alt = src.general.mode === 3 ? new ManiaMode() : src.general.mode === 1 ? new TaikoMode() : src.general.mode === 2 ? new CatchMode() : null;
    setPreview(!std);
    const rate = rateOf(mods);
    const auto = isAuto(mods);
    const hud = new Hud();
    const diff = editor.project!.difficulties[editor.diffIndex];
    const player = cloud.user?.username || prefs.creatorName || 'Guest';

    music.pause();
    music.rate = rate;
    music.el.preservesPitch = !mods.includes('NC');
    music.fadeIn(1);
    hitsounds.ignoreBeatmap = prefs.ignoreBeatmapHitsounds;
    scheduling.manualHitsounds = std && !auto;
    gameplay.active = true;

    let w = 0;
    let h = 0;
    let view: View = { scale: 1, ox: 0, oy: 0 };
    const resize = () => {
      const dpr = canvasDpr();
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(w / 640, h / 480);
      view = { scale, ox: (w - PLAYFIELD_W * scale) / 2, oy: (h - PLAYFIELD_H * scale) / 2 + 8 * scale };
      alt?.layout(w, h);
    };
    resize();
    window.addEventListener('resize', resize);

    // ---------------------------------------------------------------- clock, with a lead-in before the song starts
    const preempt = game?.proc.preempt ?? 1000;
    const objs = src.hitObjects;
    const first = game ? game.firstTime : (objs[0]?.time ?? 0);
    const last = game ? game.lastTime : objs.reduce((m, o) => Math.max(m, o.kind === 'spinner' || o.kind === 'hold' ? o.endTime : o.time), 0);
    const startAt = test ? Math.max(0, testStart.current - Math.max(1000, preempt)) : Math.min(0, first - Math.max(1500, preempt), -src.general.audioLeadIn);
    const skipTarget = first - Math.max(1800, preempt + 400);
    const canSkip = !test && skipTarget - startAt > 3000;
    let lead: { from: number; at: number } | null = null;
    let leadPaused: number | null = null;
    const now = (): number => {
      if (leadPaused !== null) return leadPaused;
      if (lead) {
        const v = lead.from + (performance.now() - lead.at) * rate;
        if (v < 0) return v;
        lead = null;
        music.seek(0);
        void music.play();
      }
      return music.time;
    };
    if (startAt < 0) {
      music.seek(0);
      lead = { from: startAt, at: performance.now() };
    } else {
      music.seek(startAt);
      void music.play();
    }

    let resumePos: Vec2 | null = null;
    const pause = () => {
      if (lead) {
        leadPaused = now();
        lead = null;
      } else music.pause();
      hitsounds.stopLoops();
      resumePos = game ? { ...game.cursor } : null;
      setPhase('paused');
    };
    const resumeNow = () => {
      if (leadPaused !== null) {
        lead = { from: leadPaused, at: performance.now() };
        leadPaused = null;
      } else void music.play();
      setPhase('playing');
    };
    controls.current = {
      pause,
      // Like stable, the player clicks where the cursor was to carry on (autoplay just carries on).
      resume: () => (game && !game.auto && resumePos ? setPhase('resuming') : resumeNow()),
      skip: () => {
        lead = null;
        leadPaused = null;
        music.seek(skipTarget);
        void music.play();
      },
    };

    // ---------------------------------------------------------------- finishing
    let done = false;
    let failing = 0;
    let dim = prefs.playDim;
    const board: BoardEntry[] = test ? [] : scores.for(diff.id).slice(0, 30).map((s) => ({ name: s.player, score: s.score, combo: s.maxCombo, mods: modsLabel(s.mods) }));
    const self: BoardEntry = { name: player, score: 0, combo: 0, mods: modsLabel(mods), self: true };
    if (board.length) board.push(self);

    const finish = () => {
      if (done) return;
      done = true;
      if (test) return quit();
      if (!game) return editor.closeProject();
      const c = game.counts;
      const score: Score = {
        id: uid(),
        diffId: diff.id,
        checksum: checksumOf(serializeBeatmap(src), diff.source),
        player,
        date: Date.now(),
        mods,
        score: game.score,
        maxCombo: game.maxCombo,
        mapMaxCombo: game.mapMaxCombo,
        ...c,
        accuracy: game.accuracy,
        grade: gradeOf(c, mods),
        hp: downsample(game.hpLog, 120),
        ...errorStats(game.errors.map((e) => e.error)),
      };
      const saved = !game.auto;
      if (saved) scores.add(score);
      hitsounds.stopLoops();
      hitsounds.playGame('applause', 0.8);
      setResult({ score, saved });
      setPhase('results');
    };

    const off = onFrame(() => {
      if (!w) return;
      const t = now();
      const ph = phaseRef.current;
      const breakNow = game?.inBreak(t) ?? false;
      const target = prefs.playDim * (breakNow && !prefs.keepDimInBreaks ? 0.45 : 1);
      dim += (target - dim) * 0.08;
      drawBackground(ctx, w, h, dim, t, { storyboard: prefs.playStoryboard, video: prefs.playVideo });

      if (alt) {
        alt.layout(w, h);
        alt.draw(ctx, t);
        if (ph === 'playing' && !lead && leadPaused === null && (t > last + 1500 || (!music.playing && music.duration && t >= music.duration - music.offset - 50))) finish();
        return;
      }
      if (!game) return;
      if (ph === 'playing' && !failing) game.update(t);
      game.draw(ctx, view, t);
      game.drawFlashlight(ctx, view, w, h, t);
      self.score = game.score;
      self.combo = game.combo;
      hud.draw(ctx, w, h, game, t, { prefs, board, showKeys: prefs.keyOverlay || game.auto, songEnd: last, startTime: startAt, test });

      if (failing) {
        const k = Math.min(1, (performance.now() - failing) / 1600);
        ctx.fillStyle = `rgba(80,0,0,${k * 0.5})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (ph === 'resuming' && resumePos) {
        const p = toScreen(view, resumePos);
        const pulse = 1 + 0.12 * Math.sin(performance.now() / 120);
        ctx.save();
        ctx.strokeStyle = '#ffaa33';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 36 * view.scale * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (!game.cinema) {
        const cs = src.difficulty.circleSize;
        const size = (h / 768) * prefs.cursorSize * (prefs.autoCursorSize ? Math.max(0.4, 1 - (0.7 * (cs - 4)) / 5) : 1);
        game.drawCursor(ctx, view, size);
      }

      const showSkip = canSkip && ph === 'playing' && t < skipTarget - 300;
      setSkipShown((s) => (s === showSkip ? s : showSkip));

      if (game.failed && !failing) {
        failing = performance.now();
        hitsounds.playGame('failsound');
        music.fadeOut(1600);
      }
      if (failing && ph !== 'failed') {
        // Stable's fail: the song winds down.
        const k = (performance.now() - failing) / 1600;
        const r = rate * Math.max(0.3, 1 - k * 0.7);
        if (Math.abs(r - music.rate) > 0.04) music.rate = r;
        if (k >= 1) {
          music.pause();
          setPhase('failed');
        }
        return;
      }
      if (ph !== 'playing') return;
      const songOver = !lead && leadPaused === null && !music.playing && music.duration > 0 && t >= music.duration - music.offset - 50;
      if ((game.finished && t > game.lastTime + (test ? 1500 : 800)) || songOver) finish();
    }, { always: true });

    // ---------------------------------------------------------------- input
    const binds = prefs.keybinds;
    const last1 = (id: string) => new Set(keysFor(id, binds).map((k) => k.split('+').pop()));
    const hit1 = last1('hit1');
    const hit2 = last1('hit2');
    const slotOf = (code: string) => (hit1.has(code) ? 0 : hit2.has(code) ? 1 : -1);
    const tryResume = () => {
      if (phaseRef.current === 'resuming' && game && resumePos && dist(game.cursor, resumePos) < 40) resumeNow();
    };
    const press = (slot: number) => {
      const ph = phaseRef.current;
      if (ph === 'resuming') return tryResume();
      if (ph === 'playing' && game && !failing) game.press(slot, now());
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const code = layoutCode(e);
      const combo = comboOf(e, code);
      const ph = phaseRef.current;
      const slot = slotOf(code);
      if (slot >= 0 || e.key === 'Escape' || code === 'Space' || code === 'Tab') e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === 'Escape' || (test && combo && keysFor('test', binds).includes(combo))) {
        if (test) return quit();
        if (ph === 'playing' && !failing) pause();
        else if (ph === 'paused' || ph === 'resuming') controls.current?.resume();
        else if (ph === 'failed' || ph === 'results') quit();
        return;
      }
      if (ph === 'results') return;
      if (combo && keysFor('quickRetry', binds).includes(combo) && !test) return retry();
      if (combo && keysFor('skip', binds).includes(combo)) {
        if (test) {
          if (ph === 'playing') pause();
          else resumeNow();
        } else if (canSkip && now() < skipTarget - 300) controls.current?.skip();
        if (slot < 0) return;
      }
      if (slot >= 0) press(slot);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const slot = slotOf(layoutCode(e));
      if (slot >= 0) game?.release(slot);
    };
    // Touch: each finger holds M1 or M2 (whichever is free), so one can stay on a slider while another taps, and the
    // cursor follows the finger that touched last.
    const fingers = new Map<number, number>();
    let aimFinger = -1;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && e.pointerId !== aimFinger) return;
      const r = canvas.getBoundingClientRect();
      game?.move(toOsu(view, { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        aimFinger = e.pointerId;
        // A tap has no move before it: aim where the finger landed before judging the press.
        onMove(e);
      }
      if (phaseRef.current === 'resuming') return tryResume();
      if (prefs.disableMouseButtons || (e.button !== 0 && e.button !== 2)) return;
      if (e.pointerType !== 'touch') return press(e.button === 0 ? 2 : 3);
      const held = new Set(fingers.values());
      const slot = !held.has(2) ? 2 : !held.has(3) ? 3 : -1;
      if (slot < 0) return;
      fingers.set(e.pointerId, slot);
      press(slot);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        const slot = fingers.get(e.pointerId);
        fingers.delete(e.pointerId);
        if (slot !== undefined) game?.release(slot);
        if (e.pointerId === aimFinger) aimFinger = [...fingers.keys()].pop() ?? -1;
        return;
      }
      if (e.button === 0 || e.button === 2) game?.release(e.button === 0 ? 2 : 3);
    };
    const onBlur = () => {
      if (!test && phaseRef.current === 'playing' && !failing && !game?.auto) pause();
    };
    const noMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', noMenu);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);

    return () => {
      off();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      hitsounds.stopLoops();
      hitsounds.ignoreBeatmap = false;
      scheduling.manualHitsounds = false;
      gameplay.active = false;
      music.rate = test ? editorRate.current : 1;
      music.el.preservesPitch = true;
      music.fadeIn(1);
    };
  }, [attempt, mods]);

  const meta = editor.project ? editor.bm.metadata : null;
  const c = controls.current;
  return (
    <div className={`player ${phase === 'results' ? 'done' : ''}`}>
      <canvas ref={ref} />
      {preview && phase === 'playing' && <div className="player-note">osu!{['', 'taiko', 'catch', 'mania'][editor.bm.general.mode]} isn't playable yet: this is an autoplay preview.</div>}
      {skipShown && (
        <button className="player-skip" onClick={() => c?.skip()}>
          {skins.current?.get('play-skip') ? <img src={textureUrl(skins.current.get('play-skip')!)} alt="Skip" /> : <span>Skip &gt;&gt;</span>}
        </button>
      )}
      {phase === 'paused' && (
        <PauseMenu
          fail={false}
          onContinue={() => c?.resume()}
          onRetry={retry}
          onQuit={quit}
        />
      )}
      {phase === 'resuming' && <div className="player-resume-hint">Click the orange circle to resume</div>}
      {phase === 'failed' && <PauseMenu fail onRetry={retry} onQuit={quit} />}
      {phase === 'results' && result && meta && (
        <Results
          score={result.score}
          title={{ artist: meta.artist, title: meta.title, version: meta.version, creator: meta.creator }}
          background={bg}
          saved={result.saved}
          onRetry={retry}
          onBack={quit}
        />
      )}
      {mode === 'test' && (
        <div className="player-testbar">
          <span className="player-testbar-mods">
            {TEST_MODS.map((id) => (
              <button
                key={id}
                className={mods.includes(id) ? 'on' : ''}
                title={id === 'AU' ? 'Autoplay' : undefined}
                onClick={() => modSelection.set(mods.includes(id) ? mods.filter((x) => x !== id) : withMod(mods, id), 'test')}
              >
                <ModIcon id={id} size={26} />
              </button>
            ))}
          </span>
          <span>Z / X or the mouse buttons to hit · Space pauses · Esc goes back to the editor</span>
        </div>
      )}
    </div>
  );
}

function PauseMenu({ fail, onContinue, onRetry, onQuit }: { fail: boolean; onContinue?: () => void; onRetry: () => void; onQuit: () => void }) {
  const skin = skins.current;
  const overlay = skin?.get(fail ? 'fail-background' : 'pause-overlay');
  const button = (name: string, label: string, tone: string, onClick: () => void) => {
    const tex = skin?.get(name);
    return (
      <button className={`pause-btn ${tone} ${tex ? 'skinned' : ''}`} onClick={onClick}>
        {tex ? <img src={textureUrl(tex)} alt={label} /> : label}
      </button>
    );
  };
  return (
    <div className={`pause-menu ${fail ? 'fail' : ''}`} style={overlay ? { backgroundImage: `url(${textureUrl(overlay)})` } : undefined}>
      {!overlay && <div className="pause-title">{fail ? 'You failed!' : 'Paused'}</div>}
      <div className="pause-buttons">
        {onContinue && button('pause-continue', 'Continue', 'green', onContinue)}
        {button('pause-retry', 'Retry', 'yellow', onRetry)}
        {button('pause-back', 'Back to Menu', 'red', onQuit)}
      </div>
    </div>
  );
}

/** The open difficulty's background image as a URL, for the ranking screen. */
function useBackgroundUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const p = editor.project;
    const name = p && editor.bm.events.background?.filename;
    const blob = p && name ? findFile(p, name) : undefined;
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, []);
  return url;
}

// The in-game HUD, laid out like stable's: health bar top-left, score, accuracy and progress top-right, combo
// bottom-left, hit error meter at the bottom, key overlay on the right and the local leaderboard on the left. Skin
// images are used when the skin has them; sizes follow stable (one SD skin pixel = height / 768 screen pixels).
import { hitsounds } from '../audio/hitsounds';
import type { Prefs } from '../project/storage';
import { skins } from '../skin/skin';
import { drawTexture } from '../editor/render/draw';
import { MOD, type ModId } from './mods';
import { drawGlyphs, drawText, type StdGame } from './stdGame';

export interface BoardEntry {
  name: string;
  score: number;
  combo: number;
  mods: string;
  self?: boolean;
}

const JUDGEMENT_COLOURS = { 300: '#32bce7', 100: '#57e313', 50: '#daae46', 0: '#ff2a2a' } as const;

/** Colours for the drawn mod icons (skins can replace them with selection-mod-*.png). */
export const MOD_COLOURS: Record<ModId, string> = {
  EZ: '#7cb82f', NF: '#3c8fd8', HT: '#8a8f99',
  HR: '#e0473f', SD: '#e89a1c', PF: '#f2c230', DT: '#9b5de5', NC: '#c45be0', HD: '#e8c31c', FL: '#2b2b33',
  RX: '#2fa7c8', AP: '#3a6fd8', SO: '#9c7a54', AU: '#ff66aa', CN: '#d0508f', V2: '#555b66',
};

/** A mod icon on a canvas: the skin's selection-mod image, else a drawn tile. `size` is its height in px. */
export function drawModIcon(ctx: CanvasRenderingContext2D, id: ModId, x: number, y: number, size: number) {
  const tex = skins.current?.get(`selection-mod-${MOD[id].icon}`);
  if (tex) {
    drawTexture(ctx, tex, x, y, size / tex.h);
    return;
  }
  const w = size * 0.92;
  ctx.save();
  ctx.fillStyle = MOD_COLOURS[id];
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - size / 2, w, size, size * 0.18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawText(ctx, id, x, y + size * 0.03, size * 0.42);
}

export class Hud {
  private shownHealth = 1;
  private announced = new Set<number>();
  private frames: number[] = [];
  private lastFrame = 0;

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, game: StdGame, t: number, opts: { prefs: Prefs; board: BoardEntry[]; showKeys: boolean; songEnd: number; startTime: number; test: boolean }) {
    const k = h / 768;
    const p = opts.prefs;
    const now = performance.now();
    this.trackFps(now);
    if (game.cinema) return;
    const skin = skins.current;

    // Health
    this.shownHealth += (game.health - this.shownHealth) * Math.min(1, (now - this.lastFrame || 16) / 120);
    const bg = skin?.get('scorebar-bg');
    const colour = skin?.get('scorebar-colour');
    if (bg && colour) {
      ctx.drawImage(bg.image, 0, 0, bg.w * k, bg.h * k);
      const fw = colour.w * this.shownHealth;
      const src = colour.image as ImageBitmap;
      ctx.drawImage(src, 0, 0, src.width * this.shownHealth, src.height, 3 * k, 10 * k, fw * k, colour.h * k);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(10 * k, 10 * k, 400 * k, 14 * k);
      ctx.fillStyle = this.shownHealth < 0.3 ? '#ff5050' : '#fff';
      ctx.fillRect(12 * k, 12 * k, 396 * k * this.shownHealth, 10 * k);
    }

    // Score, accuracy and progress
    const scoreW = drawGlyphs(ctx, 'score', String(game.score).padStart(8, '0'), w - 6 * k, 32 * k, 0.9 * k, 'right');
    const accText = `${(game.accuracy * 100).toFixed(2)}%`;
    const accW = drawGlyphs(ctx, 'score', accText, w - 6 * k, 72 * k, 0.55 * k, 'right');
    void scoreW;
    const progress = this.progress(game, t, opts.startTime);
    if (p.progressDisplay === 'topright' || p.progressDisplay === 'bottomright') {
      const cx = p.progressDisplay === 'topright' ? w - 6 * k - accW - 20 * k : w - 60 * k;
      const cy = p.progressDisplay === 'topright' ? 72 * k : h - 60 * k;
      this.drawPie(ctx, cx, cy, 11 * k, progress);
    } else if (p.progressDisplay === 'bottom') {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, h - 5 * k, w, 5 * k);
      ctx.fillStyle = progress.intro ? '#88cc55' : 'rgba(255,255,255,0.85)';
      ctx.fillRect(0, h - 5 * k, w * progress.value, 5 * k);
    }
    // Mods, under the accuracy
    const mods = game.mods;
    mods.forEach((id, i) => drawModIcon(ctx, id, w - 26 * k - (mods.length - 1 - i) * 30 * k, 112 * k, 34 * k));

    // Combo, with a bump when it changes
    const bump = 1 + 0.25 * Math.max(0, 1 - (now - game.comboChangedAt) / 160);
    drawGlyphs(ctx, 'combo', `${game.combo}x`, 8 * k, h - 32 * k * bump, 1.1 * k * bump, 'left');

    if (p.scoreMeter === 'error') this.drawErrorMeter(ctx, w, h, k * p.scoreMeterSize, game, now);
    else if (p.scoreMeter === 'colour') this.drawColourMeter(ctx, w, h, k * p.scoreMeterSize, game, now);
    if (opts.showKeys) this.drawKeys(ctx, w, h, k, game);
    if (p.showLeaderboard && opts.board.length > 1) this.drawBoard(ctx, h, k, opts.board);
    this.drawBreak(ctx, w, h, k, game, t);
    if (p.showFps) this.drawFps(ctx, w, h, k);
    this.lastFrame = now;
  }

  /** How far through the map: before the first object it fills the intro instead (shown green, as in stable). */
  private progress(game: StdGame, t: number, startTime: number) {
    if (t < game.firstTime) return { intro: true, value: Math.max(0, Math.min(1, (t - startTime) / Math.max(1, game.firstTime - startTime))) };
    return { intro: false, value: Math.max(0, Math.min(1, (t - game.firstTime) / Math.max(1, game.lastTime - game.firstTime))) };
  }

  private drawPie(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: { intro: boolean; value: number }) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.intro ? 'rgba(136,204,85,0.9)' : 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.value);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Stable's hit error meter: the 300/100/50 windows, a tick per hit and the average error as an arrow. */
  private drawErrorMeter(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, game: StdGame, now: number) {
    const win = game.windows;
    const px = 1.1 * k;
    const cx = w / 2;
    const y = h - 18 * k;
    const bh = 5 * k;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cx - win.meh * px - 2 * k, y - 10 * k, win.meh * 2 * px + 4 * k, 20 * k);
    const zone = (ms: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(cx - ms * px, y - bh / 2, ms * 2 * px, bh);
    };
    zone(win.meh, JUDGEMENT_COLOURS[50]);
    zone(win.ok, JUDGEMENT_COLOURS[100]);
    zone(win.great, JUDGEMENT_COLOURS[300]);
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - k, y - 9 * k, 2 * k, 18 * k);
    const recent = game.errors.filter((e) => now - e.at < 10000);
    for (const e of recent) {
      ctx.globalAlpha = Math.max(0, 1 - (now - e.at) / 10000) * 0.8;
      ctx.fillStyle = JUDGEMENT_COLOURS[e.value];
      ctx.fillRect(cx + e.error * px - k, y - 8 * k, 2 * k, 16 * k);
    }
    const last = game.errors.slice(-10);
    if (last.length) {
      const avg = last.reduce((s, e) => s + e.error, 0) / last.length;
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(cx + avg * px, y - 11 * k);
      ctx.lineTo(cx + avg * px - 5 * k, y - 18 * k);
      ctx.lineTo(cx + avg * px + 5 * k, y - 18 * k);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** The "Colour" score meter: a bar lit in the colour of the last judgements. */
  private drawColourMeter(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, game: StdGame, now: number) {
    const last = game.errors.slice(-12);
    const bw = 220 * k;
    ctx.save();
    last.forEach((e, i) => {
      ctx.globalAlpha = Math.max(0, 1 - (now - e.at) / 4000);
      ctx.fillStyle = JUDGEMENT_COLOURS[e.value];
      ctx.fillRect(w / 2 - bw / 2 + (i * bw) / 12, h - 22 * k, bw / 12 - 2 * k, 10 * k);
    });
    ctx.restore();
  }

  private drawKeys(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, game: StdGame) {
    const tex = skins.current?.get('inputoverlay-key');
    const labels = ['K1', 'K2', 'M1', 'M2'];
    const x = w - 24 * k;
    labels.forEach((label, i) => {
      const y = h / 2 - 72 * k + i * 48 * k;
      const down = game.keys[i];
      const scale = down ? 0.82 : 1;
      ctx.save();
      if (tex) {
        const tint = down ? (i < 2 ? { r: 255, g: 222, b: 0 } : { r: 248, g: 0, b: 158 }) : null;
        drawTexture(ctx, tint ? skins.current!.tinted('inputoverlay-key', tint)! : tex, x, y, k * scale);
      } else {
        ctx.fillStyle = down ? (i < 2 ? '#ffde00' : '#f8009e') : 'rgba(255,255,255,0.25)';
        ctx.fillRect(x - 20 * k * scale, y - 20 * k * scale, 40 * k * scale, 40 * k * scale);
      }
      ctx.restore();
      const n = game.keyCounts[i];
      drawText(ctx, n ? String(n) : label, x, y, (n > 999 ? 11 : 15) * k, tex ? '#222' : '#fff');
    });
  }

  private drawBoard(ctx: CanvasRenderingContext2D, h: number, k: number, board: BoardEntry[]) {
    const sorted = [...board].sort((a, b) => b.score - a.score);
    const selfRank = sorted.findIndex((e) => e.self);
    // The top entries, and the player's own when it's further down.
    const rows = sorted.slice(0, 5);
    if (selfRank >= 5) rows[4] = sorted[selfRank];
    const y0 = h * 0.32;
    rows.forEach((e, i) => {
      const rank = sorted.indexOf(e) + 1;
      const y = y0 + i * 44 * k;
      ctx.save();
      ctx.fillStyle = e.self ? 'rgba(255,204,34,0.35)' : 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y, 180 * k, 40 * k);
      ctx.restore();
      drawText(ctx, String(rank), 14 * k, y + 20 * k, 13 * k, 'rgba(255,255,255,0.6)');
      drawText(ctx, e.name, 30 * k, y + 12 * k, 13 * k, e.self ? '#ffdd55' : '#fff', 'left');
      drawText(ctx, e.score.toLocaleString(), 30 * k, y + 28 * k, 12 * k, '#fff', 'left');
      drawText(ctx, `${e.combo}x${e.mods ? ` ${e.mods}` : ''}`, 174 * k, y + 28 * k, 11 * k, 'rgba(255,255,255,0.7)', 'right');
    });
  }

  /** Section pass/fail in the middle of each break, and the warning arrows as it ends. */
  private drawBreak(ctx: CanvasRenderingContext2D, w: number, h: number, k: number, game: StdGame, t: number) {
    const skin = skins.current;
    game.breaks.forEach((b, i) => {
      if (b.end - b.start < 2000) return;
      const mid = (b.start + b.end) / 2;
      if (t >= mid && t < mid + 1600) {
        const pass = game.health >= 0.5;
        if (!this.announced.has(i)) {
          this.announced.add(i);
          hitsounds.playGame(pass ? 'sectionpass' : 'sectionfail');
        }
        // Blinks a few times like stable's.
        const phase = Math.floor((t - mid) / 100);
        if (phase < 6 && phase % 2 === 1) return;
        const tex = skin?.get(pass ? 'section-pass' : 'section-fail');
        if (tex) drawTexture(ctx, tex, w / 2, h / 2, k);
        else drawText(ctx, pass ? 'Pass' : 'Fail', w / 2, h / 2, 60 * k, pass ? '#7fff7f' : '#ff6060');
      }
      if (t >= b.end - 1000 && t < b.end) {
        if (Math.floor((b.end - t) / 125) % 2 === 1) return;
        const arrow = skin?.get('play-warningarrow');
        for (const [x, flip] of [[w * 0.18, false], [w * 0.82, true]] as const) {
          for (const y of [h * 0.3, h * 0.7]) {
            ctx.save();
            ctx.translate(x, y);
            if (flip) ctx.scale(-1, 1);
            if (arrow) drawTexture(ctx, arrow, 0, 0, k);
            else drawText(ctx, '▶', 0, 0, 50 * k, '#ff4444');
            ctx.restore();
          }
        }
      }
    });
  }

  private trackFps(now: number) {
    this.frames.push(now);
    while (this.frames.length && now - this.frames[0] > 1000) this.frames.shift();
  }

  private drawFps(ctx: CanvasRenderingContext2D, w: number, h: number, k: number) {
    const fps = this.frames.length;
    const bw = 64 * k;
    ctx.save();
    ctx.fillStyle = fps >= 55 ? '#8ccd2b' : fps >= 30 ? '#f3c623' : '#e9422e';
    ctx.beginPath();
    ctx.roundRect(w - bw - 4 * k, h - 26 * k, bw, 22 * k, 4 * k);
    ctx.fill();
    ctx.restore();
    drawText(ctx, `${fps} fps`, w - 4 * k - bw / 2, h - 15 * k, 13 * k, '#000');
  }
}

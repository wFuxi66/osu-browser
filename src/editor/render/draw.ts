// Low-level canvas helpers shared by the playfield, timeline and test mode. Hit objects are drawn with the selected
// skin's images when it has them (sized as in stable: a 128px hitcircle is the object's diameter), else drawn here.
import type { Rgb, Vec2 } from '../../osu/types';
import { skins, type Skin, type Texture } from '../../skin/skin';

export function rgba(c: Rgb, a = 1): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

export function shade(c: Rgb, f: number): Rgb {
  if (f < 0) return { r: c.r * (1 + f), g: c.g * (1 + f), b: c.b * (1 + f) };
  return { r: c.r + (255 - c.r) * f, g: c.g + (255 - c.g) * f, b: c.b + (255 - c.b) * f };
}

export interface View {
  /** Canvas pixels per osu!pixel. */
  scale: number;
  ox: number;
  oy: number;
}

export function toScreen(v: View, p: Vec2): Vec2 {
  return { x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale };
}

export function toOsu(v: View, p: Vec2): Vec2 {
  return { x: (p.x - v.ox) / v.scale, y: (p.y - v.oy) / v.scale };
}

/** Draws a skin texture centred on (x, y) at k screen pixels per skin pixel. */
export function drawTexture(ctx: CanvasRenderingContext2D, tex: Texture, x: number, y: number, k: number, rotation = 0) {
  const w = tex.w * k;
  const h = tex.h * k;
  if (!rotation) {
    ctx.drawImage(tex.image, x - w / 2, y - h / 2, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(tex.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** The hit circle number in the skin's font. */
function drawSkinNumber(ctx: CanvasRenderingContext2D, skin: Skin, label: string, x: number, y: number, k: number) {
  const glyphs = [...label].map((d) => skin.digit(d));
  if (glyphs.some((g) => !g)) return;
  const overlap = skin.ini.hitCircleOverlap;
  const total = glyphs.reduce((sum, g) => sum + g!.w, 0) - overlap * (glyphs.length - 1);
  let cx = x - (total * k) / 2;
  for (const g of glyphs) {
    ctx.drawImage(g!.image, cx, y - (g!.h * k) / 2, g!.w * k, g!.h * k);
    cx += (g!.w - overlap) * k;
  }
}

export function drawHitCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: Rgb,
  alpha: number,
  label: string | null,
  selected: boolean,
) {
  const skin = skins.current;
  const circle = skin?.tinted('hitcircle', colour);
  if (skin && circle) {
    const k = r / 64;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawTexture(ctx, circle, x, y, k);
    const overlay = skin.get('hitcircleoverlay');
    if (overlay && !skin.ini.overlayAboveNumber) drawTexture(ctx, overlay, x, y, k);
    // Numbers are drawn at 0.8 scale, like stable.
    if (label) drawSkinNumber(ctx, skin, label, x, y, k * 0.8);
    if (overlay && skin.ini.overlayAboveNumber) drawTexture(ctx, overlay, x, y, k);
    ctx.restore();
    if (selected) drawSelectionRing(ctx, x, y, r);
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, rgba(shade(colour, 0.25)));
  g.addColorStop(1, rgba(shade(colour, -0.35)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = r * 0.13;
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  if (label) {
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.round(r * 0.85)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = r * 0.1;
    ctx.fillText(label, x, y + r * 0.04);
  }
  if (selected) drawSelectionRing(ctx, x, y, r);
  ctx.restore();
}

export function drawSelectionRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const select = skins.current?.get('hitcircleselect');
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  if (select) {
    drawTexture(ctx, select, x, y, r / 64);
    ctx.restore();
    return;
  }
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.strokeStyle = '#ffd400';
  ctx.beginPath();
  ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawApproachCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: Rgb, alpha: number) {
  const tex = skins.current?.tinted('approachcircle', colour);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (tex) {
    drawTexture(ctx, tex, x, y, r / 64);
    ctx.restore();
    return;
  }
  ctx.strokeStyle = rgba(colour);
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function strokePolyline(ctx: CanvasRenderingContext2D, pts: Vec2[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/** Slider body: stable's skinned look with a skin, else a white border and darker track. */
export function drawSliderBody(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  r: number,
  track: Rgb,
  border: Rgb,
  alpha: number,
  selected: boolean,
) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (selected) {
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = r * 2.12;
    strokePolyline(ctx, pts);
  }
  if (skins.current) {
    ctx.restore();
    drawLegacySliderBody(ctx, pts, r, track, border, alpha);
    return;
  }
  ctx.strokeStyle = rgba(border);
  ctx.lineWidth = r * 1.9;
  strokePolyline(ctx, pts);
  ctx.strokeStyle = rgba(shade(track, -0.45));
  ctx.lineWidth = r * 1.66;
  strokePolyline(ctx, pts);
  ctx.strokeStyle = rgba(shade(track, -0.2));
  ctx.lineWidth = r * 1.0;
  strokePolyline(ctx, pts);
  ctx.restore();
}

// Offscreen canvases for skinned slider bodies: the whole body, and the track before it's laid on at 70%.
let bodyLayer: HTMLCanvasElement | null = null;
let trackLayer: HTMLCanvasElement | null = null;

function sized(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  c ??= document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/**
 * Slider body as stable draws it with skins (lazer's LegacySliderBody): a faint shadow at the edge, the border, then a
 * track running from the darkened colour at the edge to a lightened one in the middle, at 70% opacity.
 */
function drawLegacySliderBody(ctx: CanvasRenderingContext2D, pts: Vec2[], r: number, track: Rgb, border: Rgb, alpha: number) {
  const SHADOW = 1 - 59 / 64;
  const BORDER = 0.128;
  const m = ctx.getTransform();
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  bodyLayer = sized(bodyLayer, W, H);
  trackLayer = sized(trackLayer, W, H);
  // Work only in the path's bounding box (device pixels).
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of pts) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const bx = Math.max(0, Math.floor(m.a * (x0 - r) + m.e) - 2);
  const by = Math.max(0, Math.floor(m.d * (y0 - r) + m.f) - 2);
  const bw = Math.min(W, Math.ceil(m.a * (x1 + r) + m.e) + 2) - bx;
  const bh = Math.min(H, Math.ceil(m.d * (y1 + r) + m.f) + 2) - by;
  if (bw <= 0 || bh <= 0) return;

  const a = bodyLayer.getContext('2d')!;
  const b = trackLayer.getContext('2d')!;
  for (const c of [a, b]) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(bx, by, bw, bh);
    c.setTransform(m);
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
  a.strokeStyle = 'rgba(0,0,0,0.15)';
  a.lineWidth = 2 * r;
  strokePolyline(a, pts);
  a.strokeStyle = rgba(border);
  a.lineWidth = 2 * r * (1 - SHADOW);
  strokePolyline(a, pts);
  const inner = 2 * r * (1 - SHADOW - BORDER);
  a.globalCompositeOperation = 'destination-out';
  a.lineWidth = inner;
  strokePolyline(a, pts);
  a.globalCompositeOperation = 'source-over';

  const outer: Rgb = { r: track.r / 1.1, g: track.g / 1.1, b: track.b / 1.1 };
  const light = (v: number) => Math.min(255, v * 1.125 + 255 * 0.25);
  const centre: Rgb = { r: light(track.r), g: light(track.g), b: light(track.b) };
  const BANDS = 14;
  for (let i = 0; i < BANDS; i++) {
    const f = i / (BANDS - 1);
    b.strokeStyle = rgba({ r: outer.r + (centre.r - outer.r) * f, g: outer.g + (centre.g - outer.g) * f, b: outer.b + (centre.b - outer.b) * f });
    b.lineWidth = Math.max(1, inner * (1 - i / BANDS));
    strokePolyline(b, pts);
  }

  a.setTransform(1, 0, 0, 1, 0, 0);
  a.globalAlpha = 0.7;
  a.drawImage(trackLayer, bx, by, bw, bh, bx, by, bw, bh);
  a.globalAlpha = 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(bodyLayer, bx, by, bw, bh, bx, by, bw, bh);
  ctx.restore();
}

export function drawSliderTick(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  const tex = skins.current?.get('sliderscorepoint');
  ctx.save();
  ctx.globalAlpha = alpha;
  if (tex) drawTexture(ctx, tex, x, y, r / 64);
  else {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** The slider ball and its follow circle; angle is the ball's direction of travel. */
export function drawSliderBall(ctx: CanvasRenderingContext2D, at: Vec2, angle: number, r: number, colour: Rgb, alpha: number, follow = 1) {
  const skin = skins.current;
  const ball = skin?.get('sliderb');
  ctx.save();
  ctx.globalAlpha = alpha;
  if (skin && ball) {
    const k = r / 64;
    const nd = skin.get('sliderb-nd');
    if (nd) drawTexture(ctx, nd, at.x, at.y, k);
    const tint = skin.ini.allowSliderBallTint ? colour : skin.ini.sliderBall;
    drawTexture(ctx, (tint && skin.tinted('sliderb', tint)) || ball, at.x, at.y, k, angle);
    const spec = skin.get('sliderb-spec');
    if (spec) {
      ctx.globalCompositeOperation = 'lighter';
      drawTexture(ctx, spec, at.x, at.y, k);
      ctx.globalCompositeOperation = 'source-over';
    }
    const followTex = skin.get('sliderfollowcircle');
    if (followTex && follow > 0) drawTexture(ctx, followTex, at.x, at.y, k * follow);
    ctx.restore();
    return;
  }
  ctx.fillStyle = rgba(colour, 0.9);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = r * 0.08;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r * 2.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * A spinner from the skin's sprites (new style bottom/top/middle, or old style spinner-circle) at stable's 0.625 osu!pixel
 * per skin pixel, with spinner-approachcircle shrinking from `radius` over its duration. `scale` is screen pixels per
 * osu!pixel and `progress` runs from 1 at the start to 0 at the end. Returns false when the skin has no spinner.
 */
export function drawSkinSpinner(ctx: CanvasRenderingContext2D, c: Vec2, scale: number, progress: number, alpha: number, radius: number): boolean {
  const skin = skins.current;
  if (!skin) return false;
  const parts = ['spinner-bottom', 'spinner-top', 'spinner-middle2', 'spinner-middle'].map((n) => skin.get(n)).filter((t): t is Texture => !!t);
  const old = skin.get('spinner-circle');
  if (!parts.length && !old) return false;
  const k = 0.625 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const t of parts.length ? parts : [old!]) drawTexture(ctx, t, c.x, c.y, k);
  const approach = skin.get('spinner-approachcircle');
  if (approach && progress > 0) drawTexture(ctx, approach, c.x, c.y, ((2 * radius * scale) / approach.w) * progress);
  ctx.restore();
  return true;
}

export function drawReverseArrow(ctx: CanvasRenderingContext2D, at: Vec2, towards: Vec2, r: number, alpha: number) {
  const ang = Math.atan2(towards.y - at.y, towards.x - at.x);
  const tex = skins.current?.get('reversearrow');
  ctx.save();
  ctx.globalAlpha = alpha;
  if (tex) {
    drawTexture(ctx, tex, at.x, at.y, r / 64, ang);
    ctx.restore();
    return;
  }
  ctx.translate(at.x, at.y);
  ctx.rotate(ang);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  const s = r * 0.5;
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.4, -s * 0.8);
  ctx.lineTo(-s * 0.1, 0);
  ctx.lineTo(-s * 0.4, s * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawFollowPoints(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, r: number, alpha: number) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < r * 2.6) return;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const spacing = r * 0.8;
  const tex = skins.current?.get('followpoint');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff';
  for (let s = r * 1.3; s < d - r * 1.3; s += spacing) {
    const x = a.x + Math.cos(ang) * s;
    const y = a.y + Math.sin(ang) * s;
    if (tex) {
      drawTexture(ctx, tex, x, y, r / 64, ang);
      continue;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(r * 0.12, 0);
    ctx.lineTo(-r * 0.08, -r * 0.08);
    ctx.lineTo(-r * 0.08, r * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

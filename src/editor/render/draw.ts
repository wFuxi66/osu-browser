// Low-level canvas helpers shared by the playfield, timeline and test mode.
import type { Rgb, Vec2 } from '../../osu/types';

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
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.strokeStyle = '#ffd400';
  ctx.beginPath();
  ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawApproachCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: Rgb, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
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

/** Slider body in the style of the default skin: white border, darker track. */
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

export function drawReverseArrow(ctx: CanvasRenderingContext2D, at: Vec2, towards: Vec2, r: number, alpha: number) {
  const ang = Math.atan2(towards.y - at.y, towards.x - at.x);
  ctx.save();
  ctx.globalAlpha = alpha;
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
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff';
  for (let s = r * 1.3; s < d - r * 1.3; s += spacing) {
    const x = a.x + Math.cos(ang) * s;
    const y = a.y + Math.sin(ang) * s;
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

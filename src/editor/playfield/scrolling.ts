// Shared drawing for the vertically scrolling compose views (mania, catch).
import { redLineAt, tickColour, tickDivisorOf } from '../../osu/timing';
import type { Beatmap } from '../../osu/types';

/** Horizontal beat snap lines between x0 and x1 for times in [tStart, tEnd]. */
export function drawBeatLines(
  ctx: CanvasRenderingContext2D,
  bm: Beatmap,
  divisor: number,
  tStart: number,
  tEnd: number,
  yAtTime: (time: number) => number,
  x0: number,
  x1: number,
) {
  const reds = bm.timingPoints.filter((p) => p.uninherited);
  for (let i = 0; i < Math.max(1, reds.length); i++) {
    const red = reds[i] ?? redLineAt(bm, 0);
    const segEnd = reds[i + 1]?.time ?? Infinity;
    const step = red.beatLength / divisor;
    if (!(step > 0)) continue;
    const from = Math.max(tStart, i === 0 ? -Infinity : red.time);
    const to = Math.min(tEnd, segEnd);
    if (from > to) continue;
    const perBar = divisor * red.meter;
    for (let k = Math.ceil((from - red.time) / step); red.time + k * step <= to; k++) {
      const inBar = ((k % perBar) + perBar) % perBar;
      const d = tickDivisorOf(inBar, divisor);
      const y = yAtTime(red.time + k * step);
      const isBar = inBar === 0;
      ctx.strokeStyle = tickColour(d);
      ctx.globalAlpha = isBar ? 0.9 : d === 1 ? 0.6 : 0.35;
      ctx.lineWidth = isBar ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

import { toOsu, type View } from '../render/draw';
import { editor, PLAYFIELD_H, PLAYFIELD_W } from '../store';
import { StdPlayfield } from './stdPlayfield';
import type { PlayfieldMode } from './types';

/** Adapts the osu!-pixel based StdPlayfield to screen coordinates. */
export class StdMode implements PlayfieldMode {
  private pf = new StdPlayfield();
  private view: View = { scale: 1, ox: 0, oy: 0 };

  get mods() {
    return this.pf.mods;
  }
  set mods(m) {
    this.pf.mods = m;
  }

  get cursor() {
    return this.pf.hover;
  }

  layout(w: number, h: number, bars?: { top: number; bottom: number }) {
    // Same framing as the stable editor: a 640x480 virtual screen over the whole stage, with the 512x384
    // playfield centred and pushed down 24 osu!pixels so it clears the top panel.
    let scale = Math.min(w / 640, h / 480);
    let oy = (h - PLAYFIELD_H * scale) / 2 + 24 * scale;
    // Touch screens give the bars finger-sized minimums, taller than stable's: the playfield shrinks to fit between.
    if (bars && (oy < bars.top || oy + PLAYFIELD_H * scale > h - bars.bottom)) {
      const room = h - bars.top - bars.bottom - 8;
      scale = Math.min(scale, room / PLAYFIELD_H);
      oy = bars.top + 4 + (room - PLAYFIELD_H * scale) / 2;
    }
    this.view = { scale, ox: (w - PLAYFIELD_W * scale) / 2, oy };
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    this.pf.draw(ctx, this.view, t);
  }

  private osu(x: number, y: number) {
    return toOsu(this.view, { x, y });
  }

  pointerDown(x: number, y: number, button: number, touchDrag = false) {
    this.pf.pointerDown(this.osu(x, y), button, this.view, touchDrag);
  }
  pointerMove(x: number, y: number) {
    this.pf.pointerMove(this.osu(x, y));
  }
  pointerLeave() {
    this.pf.hover = null;
  }
  pointerUp() {
    this.pf.pointerUp();
  }
  doubleClick(x: number, y: number) {
    this.pf.doubleClick(this.osu(x, y));
  }
  inPlayfield(x: number, y: number) {
    // A little slack so a tap aimed at the edge still places.
    const p = this.osu(x, y);
    return p.x >= -12 && p.x <= PLAYFIELD_W + 12 && p.y >= -12 && p.y <= PLAYFIELD_H + 12;
  }
  touchPreview() {
    return editor.tool !== 'select';
  }
  cancel() {
    return this.pf.cancel();
  }
  commitPlacement() {
    this.pf.finishSlider();
  }
}

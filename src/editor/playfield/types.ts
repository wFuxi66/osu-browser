import type { Vec2 } from '../../osu/types';
import type { Modifiers } from './snapping';

/** A compose surface for one game mode, driven by the Playfield component in screen pixels. */
export interface PlayfieldMode {
  mods: Modifiers;
  /** Cursor position in osu!pixels, for the position readout (modes with a 512x384 playfield). */
  readonly cursor?: Vec2 | null;
  layout(width: number, height: number): void;
  draw(ctx: CanvasRenderingContext2D, time: number): void;
  /** `touchDrag`: a finger started dragging here (on touch, dragging empty space moves the selection). */
  pointerDown(x: number, y: number, button: number, touchDrag?: boolean): void;
  pointerMove(x: number, y: number): void;
  pointerLeave(): void;
  pointerUp(): void;
  doubleClick(x: number, y: number): void;
  /** On touch, whether a drag only moves the placement preview and the click happens where the finger lifts. */
  touchPreview?(): boolean;
  /** Handle Escape; returns true if something was cancelled. */
  cancel(): boolean;
  /** Finish an in-progress placement (Enter). */
  commitPlacement?(): void;
}

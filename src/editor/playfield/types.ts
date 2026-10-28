import type { Vec2 } from '../../osu/types';
import type { Modifiers } from './snapping';

/** A compose surface for one game mode, driven by the Playfield component in screen pixels. */
export interface PlayfieldMode {
  mods: Modifiers;
  /** Cursor position in osu!pixels, for the position readout (modes with a 512x384 playfield). */
  readonly cursor?: Vec2 | null;
  /** `bars`: how far the editor's top and bottom bars reach into the stage (CSS px). */
  layout(width: number, height: number, bars?: { top: number; bottom: number; left?: number; right?: number }): void;
  draw(ctx: CanvasRenderingContext2D, time: number): void;
  /** `touchDrag`: a finger started dragging here (on touch, dragging empty space moves the selection). */
  pointerDown(x: number, y: number, button: number, touchDrag?: boolean): void;
  pointerMove(x: number, y: number): void;
  pointerLeave(): void;
  pointerUp(): void;
  doubleClick(x: number, y: number): void;
  /** On touch, whether a drag only moves the placement preview and the click happens where the finger lifts. */
  touchPreview?(): boolean;
  /** Whether a screen point is on the playfield (touch: tapping outside it with a placement tool goes back to select). */
  inPlayfield?(x: number, y: number): boolean;
  /** Handle Escape; returns true if something was cancelled. */
  cancel(): boolean;
  /** Finish an in-progress placement (Enter). */
  commitPlacement?(): void;
}

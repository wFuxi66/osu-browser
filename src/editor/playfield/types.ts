import type { Vec2 } from '../../osu/types';
import type { Modifiers } from './snapping';

/** A compose surface for one game mode, driven by the Playfield component in screen pixels. */
export interface PlayfieldMode {
  mods: Modifiers;
  /** Cursor position in osu!pixels, for the position readout (modes with a 512x384 playfield). */
  readonly cursor?: Vec2 | null;
  layout(width: number, height: number): void;
  draw(ctx: CanvasRenderingContext2D, time: number): void;
  pointerDown(x: number, y: number, button: number): void;
  pointerMove(x: number, y: number): void;
  pointerLeave(): void;
  pointerUp(): void;
  doubleClick(x: number, y: number): void;
  /** Handle Escape; returns true if something was cancelled. */
  cancel(): boolean;
  /** Finish an in-progress placement (Enter). */
  commitPlacement?(): void;
}

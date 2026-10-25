import { describe, expect, it } from 'vitest';
import { LONG_PRESS_MS, TouchGesture, type GestureHandlers } from './touch';

function recorder(previewOnly = false) {
  const log: string[] = [];
  const h: GestureHandlers = {
    hover: (x, y) => log.push(`hover ${x},${y}`),
    previewOnly: () => previewOnly,
    press: (x, y, kind) => log.push(`press ${x},${y} ${kind}`),
    move: (x, y) => log.push(`move ${x},${y}`),
    release: () => log.push('release'),
    leave: () => log.push('leave'),
    doubleTap: (x, y) => log.push(`double ${x},${y}`),
    pinch: {
      start: () => log.push('pinch start'),
      update: (dx, s) => log.push(`pinch ${dx} ${s}`),
      end: () => log.push('pinch end'),
    },
  };
  return { g: new TouchGesture(h), log };
}

describe('TouchGesture', () => {
  it('a tap presses where the finger landed, on lift', () => {
    const { g, log } = recorder();
    g.down(1, 10, 10, 0);
    g.move(1, 13, 12);
    g.up(1, 100);
    expect(log).toEqual(['hover 10,10', 'press 10,10 tap', 'release', 'leave']);
  });

  it('a drag past the slop presses at the start, then moves', () => {
    const { g, log } = recorder();
    g.down(1, 10, 10, 0);
    g.move(1, 40, 10);
    g.move(1, 50, 10);
    g.up(1, 100);
    expect(log).toEqual(['hover 10,10', 'press 10,10 drag', 'move 40,10', 'move 50,10', 'release', 'leave']);
  });

  it('holding still is a long press (the right click)', () => {
    const { g, log } = recorder();
    g.down(1, 10, 10, 0);
    expect(g.tick(LONG_PRESS_MS - 100)).toBe(false);
    expect(g.tick(LONG_PRESS_MS)).toBe(true);
    g.up(1, 900);
    expect(log).toEqual(['hover 10,10', 'press 10,10 long', 'release', 'leave']);
  });

  it('no long press once the finger moved', () => {
    const { g, log } = recorder(true);
    g.down(1, 10, 10, 0);
    g.move(1, 60, 10);
    g.move(1, 12, 10);
    expect(g.tick(LONG_PRESS_MS)).toBe(false);
    g.up(1, 900);
    expect(log.at(-3)).toBe('press 12,10 tap');
  });

  it('in preview mode a drag moves the preview and places where the finger lifts', () => {
    const { g, log } = recorder(true);
    g.down(1, 10, 10, 0);
    g.move(1, 80, 30);
    g.up(1, 300);
    expect(log).toEqual(['hover 10,10', 'hover 80,30', 'press 80,30 tap', 'release', 'leave']);
  });

  it('two quick taps are a double tap', () => {
    const { g, log } = recorder();
    g.down(1, 10, 10, 0);
    g.up(1, 50);
    g.down(2, 12, 11, 150);
    g.up(2, 200);
    expect(log.at(-1)).toBe('double 12,11');
  });

  it('a second finger cancels the pending press and pinches', () => {
    const { g, log } = recorder();
    g.down(1, 0, 0, 0);
    g.down(2, 100, 0, 10);
    g.move(2, 200, 0);
    g.up(1, 100);
    g.up(2, 110);
    expect(log).toEqual(['hover 0,0', 'leave', 'pinch start', 'pinch 50 2', 'pinch end']);
    expect(g.tick(LONG_PRESS_MS + 10)).toBe(false);
  });
});

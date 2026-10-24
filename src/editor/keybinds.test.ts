import { describe, expect, it } from 'vitest';
import { actionFor, bind, comboOf, keyLabel, keysFor, resetBinding, shortcutOf, unbind } from './keybinds';

const ev = (mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({ ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt });

describe('key bindings', () => {
  it("uses stable's defaults", () => {
    expect(actionFor('F5', {})).toBe('test');
    expect(actionFor('Ctrl+KeyS', {})).toBe('save');
    expect(actionFor('Alt+KeyW', {})).toBe('additionNormal');
    expect(actionFor('Shift+Digit4', {})).toBe('divisor4');
    // Test mode's keys live in their own scope.
    expect(actionFor('KeyZ', {})).toBe('seekFirst');
    expect(actionFor('KeyZ', {}, 'test')).toBe('hit1');
  });

  it('rebinding takes the key away from the action that had it', () => {
    let b = bind({}, 'test', 'KeyB', 0);
    expect(keysFor('test', b)).toEqual(['KeyB']);
    expect(actionFor('F5', b)).toBeUndefined();
    b = bind(b, 'test', 'KeyW', 1);
    expect(keysFor('test', b)).toEqual(['KeyB', 'KeyW']);
    expect(keysFor('whistle', b)).toEqual([]);
    expect(actionFor('KeyW', b)).toBe('test');
    // A test-mode key doesn't steal from the editor.
    b = bind(b, 'hit1', 'KeyB', 0);
    expect(actionFor('KeyB', b)).toBe('test');
    expect(actionFor('KeyB', b, 'test')).toBe('hit1');
  });

  it('keeps only real changes, and resets', () => {
    expect(bind({}, 'save', 'Ctrl+KeyS', 0)).toEqual({});
    const b = unbind({}, 'pause', 1);
    expect(keysFor('pause', b)).toEqual(['KeyC']);
    expect(resetBinding(b, 'pause')).toEqual({});
  });

  it('reads key presses and labels them', () => {
    expect(comboOf(ev({ ctrl: true, shift: true }), 'KeyS')).toBe('Ctrl+Shift+KeyS');
    expect(comboOf(ev({ shift: true }), 'ShiftLeft')).toBeNull();
    expect(keyLabel('Ctrl+Shift+KeyS')).toBe('Ctrl+Shift+S');
    expect(keyLabel('Ctrl+Period')).toBe('Ctrl+>');
    expect(keyLabel('Shift+Digit4')).toBe('Shift+4');
    expect(shortcutOf('delete', {})).toBe('Del');
    expect(shortcutOf('test', { test: [] })).toBe('');
  });
});

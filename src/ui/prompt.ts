// Modal prompts shared by song select and the editor. Two looks, like stable: the in-game dialog
// (dark overlay with big stacked buttons) and the Windows message box used by the editor's tools.
import { useSyncExternalStore } from 'react';

export interface PromptButton {
  label: string;
  value: string;
  /** Colour of an in-game dialog button. */
  tone?: 'pink' | 'blue' | 'grey' | 'red' | 'green';
}

export interface PromptRequest {
  look: 'game' | 'win';
  title: string;
  message?: string;
  buttons: PromptButton[];
  /** Value returned for Esc / closing the dialog. */
  cancelValue: string;
  /** Optional text field (message boxes only); its value is passed to onInput as it changes. */
  input?: { value: string; onInput: (v: string) => void };
}

interface Pending extends PromptRequest {
  id: number;
  resolve: (value: string) => void;
}

let queue: Pending[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function ask(req: PromptRequest): Promise<string> {
  return new Promise((resolve) => {
    queue = [...queue, { ...req, id: nextId++, resolve }];
    emit();
  });
}

export function answer(id: number, value: string) {
  const p = queue.find((q) => q.id === id);
  if (!p) return;
  queue = queue.filter((q) => q !== p);
  emit();
  p.resolve(value);
}

export function currentPrompt(): Pending | null {
  return queue[0] ?? null;
}

export function promptOpen(): boolean {
  return queue.length > 0;
}

export function usePrompt(): Pending | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    currentPrompt,
  );
}

/** Yes/No message box; resolves true for Yes. */
export async function confirmBox(title: string, message: string): Promise<boolean> {
  const r = await ask({ look: 'win', title, message, buttons: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }], cancelValue: 'no' });
  return r === 'yes';
}

/** OK-only message box. */
export async function messageBox(title: string, message: string): Promise<void> {
  await ask({ look: 'win', title, message, buttons: [{ label: 'OK', value: 'ok' }], cancelValue: 'ok' });
}

/** Message box with a text field; resolves the text on OK, or null on Cancel. */
export async function inputBox(title: string, message: string, initial = ''): Promise<string | null> {
  let text = initial;
  const r = await ask({
    look: 'win',
    title,
    message,
    buttons: [{ label: 'OK', value: 'ok' }, { label: 'Cancel', value: 'cancel' }],
    cancelValue: 'cancel',
    input: { value: initial, onInput: (v) => (text = v) },
  });
  return r === 'ok' ? text : null;
}

// The phone's back button (and the browser's): inside the app it does what Escape does, instead of leaving the
// page. While anything other than the main menu is showing, one extra history entry sits on top; going back pops
// it, Escape runs, and the entry is put back if the app is still somewhere Escape can go back from.
import { useEffect } from 'react';

let guarded = false;
let deep = false;

function sync() {
  if (deep && !guarded) {
    history.pushState({ ...(history.state ?? {}), backGuard: true }, '');
    guarded = true;
  }
}

function onPop() {
  if (!guarded) return; // a real navigation out of the app
  guarded = false;
  // Escape's handlers listen on window; dispatching from the page reaches them like a key press would.
  if (deep) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  // Escape may open a prompt (unsaved changes) or not leave at all, so check once it has run.
  setTimeout(sync, 0);
}

/** `inside`: a screen Escape goes back from (song select, the editor, a map being played) is showing. */
export function useBackButton(inside: boolean) {
  useEffect(() => {
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    deep = inside;
    sync();
  }, [inside]);
}

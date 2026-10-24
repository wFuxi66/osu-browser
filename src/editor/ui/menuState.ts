// Which menu bar menu is open, shared so Esc can close it before it would exit the editor.
type Listener = () => void;

let open: string | null = null;
const listeners = new Set<Listener>();

export function openMenu(): string | null {
  return open;
}

export function setOpenMenu(name: string | null) {
  if (open === name) return;
  open = name;
  for (const l of listeners) l();
}

export function onMenuChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Close the open menu; returns true if one was open. */
export function closeMenus(): boolean {
  if (!open) return false;
  setOpenMenu(null);
  return true;
}

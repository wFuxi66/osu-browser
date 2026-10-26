// The chosen skin's interface images (menu-back, selection-mods, …) at stable's size, one SD skin pixel per --u, with
// the "-over" image shown while the button is hovered.
import { useSkin } from '../play/ModIcon';
import { skins, textureUrl } from './skin';

/** Whether the chosen skin has its own image for this element. */
export function hasSkinUi(name: string): boolean {
  return !!skins.chosen?.has(name);
}

export function SkinUi({ name }: { name: string }) {
  useSkin();
  const skin = skins.chosen;
  const tex = skin?.has(name) ? skin.get(name) : undefined;
  if (!tex) return null;
  const over = skin!.has(`${name}-over`) ? skin!.get(`${name}-over`) : undefined;
  const style = (t: typeof tex) => ({ width: `calc(var(--u) * ${t.w})`, height: `calc(var(--u) * ${t.h})` });
  return (
    <span className="skin-ui">
      <img src={textureUrl(tex)} alt="" draggable={false} style={style(tex)} />
      {over && <img className="skin-ui-over" src={textureUrl(over)} alt="" draggable={false} style={style(over)} />}
    </span>
  );
}

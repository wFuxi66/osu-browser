import { useSyncExternalStore } from 'react';
import { skins, textureUrl } from '../skin/skin';
import { MOD_COLOURS } from './hud';
import { MOD, type ModId } from './mods';

let skinRev = 0;
skins.onChange(() => skinRev++);

/** Re-renders when the skin changes (mod icons and grades come from it). */
export function useSkin(): number {
  return useSyncExternalStore((l) => skins.onChange(l), () => skinRev);
}

/** A mod's icon: the skin's selection-mod image, else a drawn tile. */
export function ModIcon({ id, size = 40 }: { id: ModId; size?: number }) {
  useSkin();
  const tex = skins.current?.get(`selection-mod-${MOD[id].icon}`);
  if (tex) return <img className="mod-icon" src={textureUrl(tex)} alt={id} title={MOD[id].name} style={{ height: size }} draggable={false} />;
  return (
    <span className="mod-icon drawn" title={MOD[id].name} style={{ height: size, width: size * 0.92, background: MOD_COLOURS[id], fontSize: size * 0.4 }}>
      {id}
    </span>
  );
}

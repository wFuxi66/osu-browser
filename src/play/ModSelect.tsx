// Stable's mod selection (F1 in song select): three rows of tiles, the score multiplier, "1. Reset All Mods" and
// "2. Close". A tile cycles through its mods (Sudden Death → Perfect, Double Time → Nightcore, Autoplay → Cinema);
// right-click cycles back. Q W E / A S D F G / Z X C V B toggle them from the keyboard.
import { useEffect, useState } from 'react';
import { layoutCode } from '../editor/shortcuts';
import { ModIcon } from './ModIcon';
import { cycleTile, MODS, modSelection, scoreMultiplier, tileMods, useMods, type ModDef, type ModRow } from './mods';

const ROWS: { row: ModRow; label: string }[] = [
  { row: 'reduction', label: 'Difficulty Reduction' },
  { row: 'increase', label: 'Difficulty Increase' },
  { row: 'special', label: 'Special' },
];

export function ModSelect({ onClose }: { onClose: () => void }) {
  const mods = useMods();
  const [hover, setHover] = useState<ModDef | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const code = layoutCode(e);
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'F1' || code === 'Digit2' || e.key === 'Enter') return onClose();
      if (code === 'Digit1') return modSelection.set([]);
      const def = MODS.find((d) => d.key === code);
      if (def) modSelection.set(cycleTile(modSelection.get(), def.row, def.tile, e.shiftKey));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const multiplier = scoreMultiplier(mods);
  return (
    <div className="modsel" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modsel-intro">
        {hover ? (
          <>
            <b>{hover.name}</b>: {hover.description}
          </>
        ) : (
          'Mods provide different ways to enjoy gameplay. Some have an effect on the score you can achieve during ranked play. Others are just for fun.'
        )}
      </div>
      <div className={`modsel-mult ${multiplier < 1 ? 'down' : multiplier > 1 ? 'up' : ''}`}>
        Score Multiplier: {multiplier.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
      </div>
      <div className="modsel-rows">
        {ROWS.map(({ row, label }) => {
          const tiles = [...new Set(MODS.filter((d) => d.row === row).map((d) => d.tile))];
          return (
            <div key={row} className={`modsel-row ${row}`}>
              <div className="modsel-label">{label}</div>
              <div className="modsel-tiles">
                {tiles.map((tile) => {
                  const cycle = tileMods(row, tile);
                  const on = cycle.find((d) => mods.includes(d.id));
                  const shown = on ?? cycle[0];
                  return (
                    <button
                      key={tile}
                      className={`modsel-tile ${on ? 'on' : ''}`}
                      onClick={() => modSelection.set(cycleTile(mods, row, tile))}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        modSelection.set(cycleTile(mods, row, tile, true));
                      }}
                      onMouseEnter={() => setHover(shown)}
                      onMouseLeave={() => setHover(null)}
                    >
                      <ModIcon id={shown.id} size={84} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="modsel-buttons">
        <button className="modsel-btn reset" onClick={() => modSelection.set([])}>
          1. Reset All Mods
        </button>
        <button className="modsel-btn close" onClick={onClose}>
          2. Close
        </button>
      </div>
    </div>
  );
}

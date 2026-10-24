// The ranking screen after a play (or for a local score clicked in song select), laid out like stable's: the map and
// player at the top, score and hit counts on the left, the grade on the right, and the health graph.
import { useEffect } from 'react';
import { skins, textureUrl } from '../skin/skin';
import { ModIcon, useSkin } from './ModIcon';
import type { Grade, Score } from './scores';

const GRADE_LETTERS: Record<Grade, string> = { XH: 'SS', X: 'SS', SH: 'S', S: 'S', A: 'A', B: 'B', C: 'C', D: 'D' };
const GRADE_COLOURS: Record<Grade, string> = { XH: '#e0e8ff', X: '#ffdd55', SH: '#e0e8ff', S: '#ffdd55', A: '#77dd44', B: '#4499ff', C: '#cc66ff', D: '#ff4455' };

export function GradeIcon({ grade, small = false }: { grade: Grade; small?: boolean }) {
  useSkin();
  const tex = skins.current?.get(`ranking-${grade}${small ? '-small' : ''}`);
  if (tex) return <img className={`grade-icon ${small ? 'small' : ''}`} src={textureUrl(tex)} alt={GRADE_LETTERS[grade]} draggable={false} />;
  return (
    <span className={`grade-icon drawn ${small ? 'small' : ''}`} style={{ color: GRADE_COLOURS[grade] }}>
      {GRADE_LETTERS[grade]}
    </span>
  );
}

function HitIcon({ name, fallback }: { name: string; fallback: string }) {
  const tex = skins.current?.get(name);
  return tex ? <img className="rk-hit" src={textureUrl(tex)} alt={fallback} draggable={false} /> : <span className="rk-hit drawn">{fallback}</span>;
}

export function Results({
  score,
  title,
  background,
  saved,
  onRetry,
  onBack,
}: {
  score: Score;
  title: { artist: string; title: string; version: string; creator: string };
  background: string | null;
  saved: boolean;
  onRetry?: () => void;
  onBack: () => void;
}) {
  useSkin();
  // The player's own Esc handling covers it during play; from song select it's ours.
  useEffect(() => {
    if (onRetry) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack, onRetry]);

  const date = new Date(score.date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  const fc = score.maxCombo >= score.mapMaxCombo;
  const graph = score.hp.length > 1 ? score.hp.map((v, i) => `${(i / (score.hp.length - 1)) * 300},${(1 - v) * 80}`).join(' ') : '';
  const cell = (icon: string, label: string, n: number) => (
    <div className="rk-cell">
      <HitIcon name={icon} fallback={label} />
      <span className="rk-count">{n}x</span>
    </div>
  );
  return (
    <div className="rk">
      <div className="rk-bg">{background && <img src={background} alt="" />}</div>
      <header className="rk-head">
        <div className="rk-title">
          {title.artist} - {title.title} [{title.version}]
        </div>
        <div className="rk-sub">Beatmap by {title.creator || 'Unknown'}</div>
        <div className="rk-sub">
          Played by {score.player} on {date}.{!saved && ' (Autoplay: not saved)'}
        </div>
      </header>
      <div className="rk-panel">
        <div className="rk-score">{String(score.score).padStart(8, '0')}</div>
        <div className="rk-grid">
          {cell('hit300', '300', score.n300)}
          {cell('hit300g', '激', score.nGeki)}
          {cell('hit100', '100', score.n100)}
          {cell('hit100k', '喝', score.nKatu)}
          {cell('hit50', '50', score.n50)}
          {cell('hit0', 'X', score.nMiss)}
        </div>
        <div className="rk-row">
          <div>
            <div className="rk-label">Max Combo</div>
            <div className="rk-big">{score.maxCombo}x</div>
          </div>
          <div>
            <div className="rk-label">Accuracy</div>
            <div className="rk-big">{(score.accuracy * 100).toFixed(2)}%</div>
          </div>
        </div>
        {graph && (
          <svg className="rk-graph" viewBox="0 0 300 80" preserveAspectRatio="none">
            <polyline points={graph} fill="none" stroke="#99ee55" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        <div className="rk-errors">
          Error: {score.errorEarly.toFixed(1)}ms - +{score.errorLate.toFixed(1)}ms avg · Unstable rate: {score.unstableRate.toFixed(1)}
        </div>
      </div>
      <div className="rk-grade">
        <GradeIcon grade={score.grade} />
        {fc && <div className="rk-perfect">Full combo!</div>}
        <div className="rk-mods">
          {score.mods.map((m) => (
            <ModIcon key={m} id={m} size={52} />
          ))}
        </div>
      </div>
      <div className="rk-buttons">
        {onRetry && (
          <button className="rk-btn retry" onClick={onRetry}>
            Retry
          </button>
        )}
        <button className="rk-btn back" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

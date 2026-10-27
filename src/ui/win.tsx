// WinForms-style building blocks for the editor's tool windows (Song Setup, Timing Setup, Rotate by...).
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function WinDialog({
  title,
  children,
  onClose,
  footer,
  width = 440,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
  className?: string;
}) {
  // Drag the window by its title bar, like a real one.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
      // Enter presses OK, like stable's default button. It waits a tick so a number box being typed in commits first.
      const el = e.target as HTMLElement;
      if (e.key === 'Enter' && !e.repeat && !el.closest('textarea, select, button:not(.win-ok)')) {
        const ok = ref.current?.querySelector<HTMLButtonElement>('.win-ok');
        if (!ok) return;
        e.preventDefault();
        setTimeout(() => !ok.disabled && ok.click());
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);
  return (
    <div className="win-backdrop" onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={ref}
        className={`win-window ${className}`}
        role="dialog"
        aria-label={title}
        style={{ width, ...(pos ? { position: 'fixed', left: pos.x, top: pos.y } : null) }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div
          className="win-titlebar"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            const r = ref.current!.getBoundingClientRect();
            drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => drag.current && setPos({ x: e.clientX - drag.current.dx, y: Math.max(0, e.clientY - drag.current.dy) })}
          onPointerUp={() => (drag.current = null)}
        >
          <span>{title}</span>
          <button className="win-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="win-body">{children}</div>
        {footer && <div className="win-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** OK / Cancel as two wide buttons, like stable's Song Setup and Timing Setup. */
export function OkCancel({ onOk, onCancel, okDisabled, okLabel = 'OK' }: { onOk: () => void; onCancel: () => void; okDisabled?: boolean; okLabel?: string }) {
  return (
    <div className="win-okcancel">
      <button className="win-ok" onClick={onOk} disabled={okDisabled}>{okLabel}</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

export function WinTabs<T extends string>({ tabs, value, onChange, children }: { tabs: readonly T[]; value: T; onChange: (t: T) => void; children: ReactNode }) {
  return (
    <div className="win-tabs">
      <div className="win-tabstrip">
        {tabs.map((t) => (
          <button key={t} className={`win-tab ${t === value ? 'active' : ''}`} onClick={() => onChange(t)}>{t}</button>
        ))}
      </div>
      <div className="win-tabpage">{children}</div>
    </div>
  );
}

export function GroupBox({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`win-group ${className}`}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** Label on the left (right-aligned, bold), control on the right. */
export function Row({ label, children, dim, hint }: { label: string; children: ReactNode; dim?: boolean; hint?: string }) {
  return (
    <div className={`win-row ${dim ? 'dim' : ''}`} title={hint}>
      <span className="win-row-label">{label}</span>
      <span className="win-row-control">{children}</span>
    </div>
  );
}

/** Trackbar with a numeric box, for difficulty settings. */
export function TrackRow({ label, value, min, max, step, onChange, left, right, disabled }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; left?: string; right?: string; disabled?: boolean }) {
  return (
    <div className={`win-track ${disabled ? 'dim' : ''}`}>
      <div className="win-track-label">{label}</div>
      <div className="win-track-line">
        {left && <span className="win-track-end">{left}</span>}
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
        {right && <span className="win-track-end">{right}</span>}
        <NumberBox value={value} min={min} max={max} step={step} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}

/** Numeric up-down that accepts "1,5" as well as "1.5". */
export function NumberBox({ value, onChange, min, max, step = 1, disabled, width = 64, digits }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean; width?: number; digits?: number }) {
  const shown = digits !== undefined ? Number(value.toFixed(digits)) : value;
  const [text, setText] = useState(String(shown));
  useEffect(() => setText(String(shown)), [shown]);
  const commit = (s: string) => {
    let v = Number(s.replace(',', '.'));
    if (!Number.isFinite(v)) return setText(String(shown));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };
  return (
    <span className="win-num" style={{ width }}>
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            commit(String(value + (e.key === 'ArrowUp' ? step : -step)));
          }
        }}
      />
      <span className="win-num-arrows">
        <button className="win-arrow" tabIndex={-1} disabled={disabled} onClick={() => commit(String(Number((value + step).toFixed(6))))}>▲</button>
        <button className="win-arrow" tabIndex={-1} disabled={disabled} onClick={() => commit(String(Number((value - step).toFixed(6))))}>▼</button>
      </span>
    </span>
  );
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`win-check ${disabled ? 'dim' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function Radio({ label, checked, onChange, disabled, name }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean; name: string }) {
  return (
    <label className={`win-check ${disabled ? 'dim' : ''}`}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} /> {label}
    </label>
  );
}

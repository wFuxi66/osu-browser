import type { ReactNode } from 'react';
import { editor } from '../../store';

export function Modal({ title, children, footer, wide, onClose }: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; onClose?: () => void }) {
  const close = onClose ?? (() => editor.openDialog(null));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close" onClick={close} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      <span className="form-control">{children}</span>
      {hint && <span className="form-hint">{hint}</span>}
    </label>
  );
}

export function SliderField({ label, value, min, max, step, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" className="num" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

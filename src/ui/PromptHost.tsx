import { useEffect } from 'react';
import { answer, usePrompt } from './prompt';

/** Renders the front prompt of the queue. Keys: Esc cancels, Enter picks the first button, 1–9 pick a button. */
export function PromptHost() {
  const p = usePrompt();

  useEffect(() => {
    if (!p) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(p.id, p.cancelValue);
      else if (e.key === 'Enter') answer(p.id, p.buttons[0].value);
      else if ((e.target as HTMLElement).tagName === 'INPUT') return;
      else if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(5)) <= p.buttons.length) answer(p.id, p.buttons[Number(e.code.slice(5)) - 1].value);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [p]);

  if (!p) return null;

  if (p.look === 'game') {
    return (
      <div className="gdialog" onMouseDown={(e) => e.target === e.currentTarget && answer(p.id, p.cancelValue)}>
        <div className="gdialog-head">
          <div className="gdialog-title">{p.title}</div>
          {p.message && <div className="gdialog-msg">{p.message}</div>}
        </div>
        <div className="gdialog-buttons">
          {p.buttons.map((b, i) => (
            <button key={b.value} className={`gdialog-btn tone-${b.tone ?? 'grey'}`} onClick={() => answer(p.id, b.value)}>
              <span className="gdialog-num">{i + 1}.</span> {b.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="win-backdrop">
      <div className="win-window win-msgbox" role="dialog" aria-label={p.title}>
        <div className="win-titlebar">
          <span>{p.title}</span>
          <button className="win-x" onClick={() => answer(p.id, p.cancelValue)} aria-label="Close">✕</button>
        </div>
        <div className="win-msgbody">
          {!p.input && <span className="win-msgicon">?</span>}
          <span className="win-msgtext">
            {p.message}
            {p.input && <input className="win-msginput" autoFocus defaultValue={p.input.value} onFocus={(e) => e.target.select()} onChange={(e) => p.input!.onInput(e.target.value)} />}
          </span>
        </div>
        <div className="win-msgbuttons">
          {p.buttons.map((b, i) => (
            <button key={b.value} className="win-btn" autoFocus={i === 0 && !p.input} onClick={() => answer(p.id, b.value)}>{b.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

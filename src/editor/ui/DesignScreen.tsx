import { useEffect, useRef, useState, type ReactNode } from 'react';
import { music } from '../../audio/music';
import {
  EASING_NAMES,
  ORIGIN_ANCHOR,
  propValue,
  SB_COMMAND_ARITY,
  SB_COMMAND_NAMES,
  SB_LAYERS,
  SB_ORIGINS,
  spriteStateAt,
  type Prop,
  type SbCommand,
  type SbCommandType,
  type SbElement,
  type SbEntry,
  type SbLayer,
  type SbSprite,
} from '../../osu/storyboard';
import { redLineAt } from '../../osu/timing';
import { onFrame } from '../playback';
import { editor, formatTimestamp, useEditor } from '../store';
import { design, setKeyframe, setPositionAt, type KeyframeType } from '../storyboard/design';
import { fitFrame, SB_H, SB_W, SB_WIDE_MARGIN, storyboard, type SbFrame, type SbRef, type SbSource } from '../storyboard/runtime';
import { drawBackground } from './Playfield';

const IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp)$/i;
const SOUND_RE = /\.(wav|ogg|mp3)$/i;

/**
 * F2 design mode: a storyboard preview you can click and drag sprites in (keyframing at the current time,
 * like stable), element/command editing, and the raw script for anything else.
 */
export function DesignScreen() {
  const [tab, setTab] = useState<'visual' | 'script'>('visual');
  useEditor();
  return (
    <div className="design-screen">
      <div className="design-main">
        <SbPreview />
        <SpriteTimeline />
      </div>
      <div className="design-side">
        <div className="tabs">
          <button className={tab === 'visual' ? 'active' : ''} onClick={() => setTab('visual')}>Sprites</button>
          <button className={tab === 'script' ? 'active' : ''} onClick={() => setTab('script')}>Script</button>
        </div>
        {tab === 'visual' ? <VisualPanel /> : <ScriptPanel />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ preview canvas

function useSongTime(intervalWhilePlaying = 100): number {
  const [t, setT] = useState(() => Math.round(music.time));
  const last = useRef({ t: -1, at: 0 });
  useEffect(
    () =>
      onFrame((now) => {
        const r = Math.round(now);
        if (r === last.current.t) return;
        const at = performance.now();
        if (music.playing && at - last.current.at < intervalWhilePlaying) return;
        last.current = { t: r, at };
        setT(r);
      }),
    [intervalWhilePlaying],
  );
  return t;
}

function SbPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const ed = useEditor();

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    let frame: SbFrame = { ox: 0, oy: 0, scale: 1 };
    let hover: SbRef | null = null;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(canvas);

    const toSb = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left - frame.ox) / frame.scale, y: (e.clientY - r.top - frame.oy) / frame.scale };
    };
    const outline = (ref: SbRef | null, t: number, colour: string, origin: boolean) => {
      const el = ref && storyboard.get(ref);
      if (!el || el.kind === 'sample') return;
      const c = storyboard.compiledFor(el);
      const s = spriteStateAt(c, t);
      const fi = s && storyboard.frameImage(c, t);
      if (!s || !fi) return;
      const q = storyboard.quad(c, s, fi.img.naturalWidth, fi.img.naturalHeight);
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, frame.ox + p.x * frame.scale, frame.oy + p.y * frame.scale));
      ctx.closePath();
      ctx.stroke();
      if (origin) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(frame.ox + s.x * frame.scale, frame.oy + s.y * frame.scale, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const off = onFrame((t) => {
      if (!w || !editor.hasProject) return;
      const wide = editor.bm.general.widescreenStoryboard;
      frame = fitFrame(w, h, true);
      drawBackground(ctx, w, h, 0, t, { frame, storyboard: true });
      const X = (x: number) => frame.ox + x * frame.scale;
      const Y = (y: number) => frame.oy + y * frame.scale;
      ctx.save();
      // Darken what the game wouldn't show.
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const m = wide ? SB_WIDE_MARGIN : 0;
      ctx.fillRect(0, 0, X(-m), h);
      ctx.fillRect(X(SB_W + m), 0, w - X(SB_W + m), h);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.strokeRect(X(0), Y(0), SB_W * frame.scale, SB_H * frame.scale);
      if (design.showPlayfield) {
        ctx.strokeStyle = 'rgba(102,204,255,0.35)';
        ctx.strokeRect(X(64), Y(56), 512 * frame.scale, 384 * frame.scale);
      }
      ctx.restore();
      if (hover && (!design.selected || hover.index !== design.selected.index || hover.source !== design.selected.source)) outline(hover, t, 'rgba(255,255,255,0.5)', false);
      outline(design.selected, t, '#ff66aa', true);
    });

    const down = (e: PointerEvent) => {
      if (!editor.hasProject || e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const p = toSb(e);
      const t = music.time;
      const hit = storyboard.hitTest(p, t);
      // Keep dragging the selected sprite even when something else is drawn on top of it.
      const sel = design.selected;
      const ref = sel && isUnder(sel, p, t) ? sel : hit;
      if (!ref) {
        design.select(null);
        return;
      }
      if (!sel || sel.index !== ref.index || sel.source !== ref.source) design.select(ref);
      design.beginDrag(ref, p, e.shiftKey ? 'scale' : e.ctrlKey || e.altKey ? 'rotate' : 'move');
    };
    const move = (e: PointerEvent) => {
      const p = toSb(e);
      if (coordRef.current) coordRef.current.textContent = `x ${Math.round(p.x)}  y ${Math.round(p.y)}`;
      if (design.dragging) design.dragTo(p);
      else hover = storyboard.hitTest(p, music.time);
    };
    const up = () => design.endDrag();
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('text/x-sb-file')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = e.dataTransfer?.getData('text/x-sb-file');
      if (!file) return;
      e.preventDefault();
      const p = toSb(e);
      if (SOUND_RE.test(file)) design.addSample(file);
      else design.addSprite(file, p.x, p.y);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dragover', over);
    canvas.addEventListener('drop', drop);
    return () => {
      off();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('dragover', over);
      canvas.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="sb-preview">
      <canvas ref={canvasRef} data-wheel="playfield" />
      <div className="sb-preview-bar">
        <span ref={coordRef} className="mono muted" />
        <span className="muted">Drag: move · Shift+drag: scale · Ctrl+drag: rotate</span>
        <label className="check">
          <input type="checkbox" checked={design.autoKeyframe} onChange={(e) => { design.autoKeyframe = e.target.checked; ed.emit(); }} />
          Keyframe moves at current time
        </label>
        <label className="check">
          <input type="checkbox" checked={design.showPlayfield} onChange={(e) => { design.showPlayfield = e.target.checked; ed.emit(); }} />
          Playfield outline
        </label>
      </div>
    </div>
  );
}

function isUnder(ref: SbRef, p: { x: number; y: number }, t: number): boolean {
  const el = storyboard.get(ref);
  if (!el || el.kind === 'sample') return false;
  const c = storyboard.compiledFor(el);
  const s = spriteStateAt(c, t);
  const fi = s && storyboard.frameImage(c, t);
  if (!s || !fi) return false;
  const q = storyboard.quad(c, s, fi.img.naturalWidth, fi.img.naturalHeight);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const cr = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (cr && sign && cr !== sign) return false;
    sign ||= cr;
  }
  return true;
}

// ------------------------------------------------------------------ per-sprite command timeline

const TIMELINE_ROWS: { prop: Prop; label: string; colour: string }[] = [
  { prop: 'alpha', label: 'Fade', colour: '#bbbbbb' },
  { prop: 'x', label: 'Move X', colour: '#66ccff' },
  { prop: 'y', label: 'Move Y', colour: '#4aa3d8' },
  { prop: 'scale', label: 'Scale', colour: '#66dd88' },
  { prop: 'vscale', label: 'Vec scale', colour: '#4fb36b' },
  { prop: 'rotation', label: 'Rotate', colour: '#ffcc55' },
  { prop: 'colour', label: 'Colour', colour: '#ff66aa' },
  { prop: 'flipH', label: 'Flip H', colour: '#aa88ff' },
  { prop: 'flipV', label: 'Flip V', colour: '#9977ee' },
  { prop: 'additive', label: 'Additive', colour: '#ff8866' },
];

/** Bars for every (loop-expanded) command of the selected sprite over its lifetime; click to seek. */
function SpriteTimeline() {
  const ref = useRef<HTMLCanvasElement>(null);
  const ed = useEditor();
  const el = design.selectedElement;
  const sprite = el && el.kind !== 'sample' ? el : null;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !sprite) return;
    const ctx = canvas.getContext('2d')!;
    const LABEL = 70;
    const ROW = 14;
    let range = { a: 0, b: 1 };
    const off = onFrame((t) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const c = storyboard.compiledFor(sprite);
      const rows = TIMELINE_ROWS.filter((r) => c.timelines[r.prop]?.length);
      const h = Math.max(1, rows.length) * ROW + 6;
      if (canvas.height !== h * dpr || canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!Number.isFinite(c.start)) return;
      const pad = Math.max(200, (c.end - c.start) * 0.04);
      range = { a: c.start - pad, b: c.end + pad };
      const X = (time: number) => LABEL + ((time - range.a) / (range.b - range.a)) * (w - LABEL - 4);
      ctx.font = '10px Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(X(c.start), 0, X(c.end) - X(c.start), h);
      rows.forEach((r, i) => {
        const y = 3 + i * ROW;
        ctx.fillStyle = '#8a8aa0';
        ctx.fillText(r.label, 4, y + 10);
        ctx.fillStyle = r.colour;
        for (const s of c.timelines[r.prop]!) {
          const x0 = X(s.start);
          const x1 = Math.max(x0 + 2, X(s.end));
          ctx.globalAlpha = 0.8;
          ctx.fillRect(x0, y + 2, x1 - x0, ROW - 5);
        }
        ctx.globalAlpha = 1;
      });
      ctx.fillStyle = '#ff66aa';
      ctx.fillRect(X(t) - 1, 0, 2, h);
    });
    const seek = (e: PointerEvent) => {
      if (e.type === 'pointermove' && !(e.buttons & 1)) return;
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (x < LABEL) return;
      music.seek(range.a + ((x - LABEL) / (r.width - LABEL - 4)) * (range.b - range.a));
    };
    canvas.addEventListener('pointerdown', seek);
    canvas.addEventListener('pointermove', seek);
    return () => {
      off();
      canvas.removeEventListener('pointerdown', seek);
      canvas.removeEventListener('pointermove', seek);
    };
  }, [sprite, ed.rev]);

  if (!sprite) return <div className="sb-timeline empty muted">Select a sprite to see its commands over time.</div>;
  return (
    <div className="sb-timeline">
      <canvas ref={ref} />
    </div>
  );
}

// ------------------------------------------------------------------ side panel

function VisualPanel() {
  const ed = useEditor();
  const files = [...ed.project!.files.keys()];
  const images = files.filter((n) => IMAGE_RE.test(n));
  const sounds = files.filter((n) => SOUND_RE.test(n) && n !== ed.bm.general.audioFilename);
  const missing = storyboard.missingFiles();
  return (
    <div className="design-panel">
      <div className="field">
        <span>Add to</span>
        <select value={design.target} onChange={(e) => { design.target = e.target.value as SbSource; ed.emit(); }}>
          <option value="osb">Shared storyboard (.osb)</option>
          <option value="diff">This difficulty only</option>
        </select>
      </div>
      <div className="row">
        <button onClick={() => design.undo()} disabled={!design.canUndo} title="Ctrl+Z">Undo</button>
        <button onClick={() => design.redo()} disabled={!design.canRedo} title="Ctrl+Y">Redo</button>
      </div>
      <Library images={images} sounds={sounds} />
      {missing.length > 0 && (
        <p className="warn">Missing files: {missing.slice(0, 5).join(', ')}{missing.length > 5 ? ` and ${missing.length - 5} more` : ''}. Add them with File → Add files.</p>
      )}
      <ElementList />
      <ElementProps images={images} sounds={sounds} />
    </div>
  );
}

function Library({ images, sounds }: { images: string[]; sounds: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <h3 className="collapsible" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Library</h3>
      {open && (
        <>
          <p className="muted small">Drag an image onto the preview, or click + to add it in the centre at the current time.</p>
          <ul className="file-list sb-library">
            {images.map((n) => (
              <li key={n} draggable onDragStart={(e) => e.dataTransfer.setData('text/x-sb-file', n)}>
                <span>🖼 {n}</span>
                <button className="small" onClick={() => design.addSprite(n)} title="Add sprite">+</button>
                <button className="small" onClick={() => addAnimation(n)} title="Add as animation (name0.png, name1.png, …)">anim</button>
              </li>
            ))}
            {sounds.map((n) => (
              <li key={n} draggable onDragStart={(e) => e.dataTransfer.setData('text/x-sb-file', n)}>
                <span>🔊 {n}</span>
                <button className="small" onClick={() => design.addSample(n)} title="Add sample at the current time">+</button>
              </li>
            ))}
            {images.length + sounds.length === 0 && <li className="muted">No images or sounds yet. Use File → Add files.</li>}
          </ul>
        </>
      )}
    </section>
  );
}

function addAnimation(frame0: string) {
  // "sb/fire0.png" → base "sb/fire.png" with as many consecutive frames as exist.
  const m = /^(.*?)(\d+)(\.[^.]+)$/.exec(frame0);
  if (!m) return editor.toast('Animation frames must be numbered, e.g. fire0.png, fire1.png…', 'error');
  const [, stem, , ext] = m;
  const names = new Set([...editor.project!.files.keys()].map((n) => n.toLowerCase()));
  let count = 0;
  while (names.has(`${stem}${count}${ext}`.toLowerCase())) count++;
  if (!count) return editor.toast(`No ${stem}0${ext} found.`, 'error');
  design.addSprite(`${stem}${ext}`, 320, 240, 'Foreground', { frameCount: count, frameDelay: 100 });
}

function elementLabel(el: SbElement): string {
  return el.kind === 'sample' ? `🔊 ${el.file}` : `${el.kind === 'animation' ? '🎞' : '🖼'} ${el.file}`;
}

function ElementList() {
  const ed = useEditor();
  const t = useSongTime(250);
  const [layer, setLayer] = useState<'all' | SbLayer>('all');
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [query, setQuery] = useState('');
  const rows: { ref: SbRef; el: SbElement }[] = [];
  let total = 0;
  for (const source of ['osb', 'diff'] as const) {
    storyboard[source].elements.forEach((el, index) => {
      if (layer !== 'all' && el.layer !== layer) return;
      if (query && !el.file.toLowerCase().includes(query.toLowerCase())) return;
      if (onlyVisible) {
        if (el.kind === 'sample') return;
        const c = storyboard.compiledFor(el);
        if (!(t >= c.start && t <= c.end)) return;
      }
      total++;
      if (rows.length < 300) rows.push({ ref: { source, index }, el });
    });
  }
  const sel = design.selected;
  return (
    <section>
      <h3>Elements <span className="muted small">({total})</span></h3>
      <div className="row wrap">
        <select value={layer} onChange={(e) => setLayer(e.target.value as 'all' | SbLayer)}>
          <option value="all">All layers</option>
          {SB_LAYERS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input placeholder="Filter by file" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 80 }} />
        <label className="check"><input type="checkbox" checked={onlyVisible} onChange={(e) => setOnlyVisible(e.target.checked)} /> Visible now</label>
      </div>
      <ul className="sb-elements">
        {rows.map(({ ref, el }) => {
          const active = sel?.source === ref.source && sel.index === ref.index;
          return (
            <li
              key={`${ref.source}${ref.index}`}
              className={active ? 'active' : ''}
              onClick={() => design.select(ref)}
              onDoubleClick={() => {
                const start = el.kind === 'sample' ? el.time : storyboard.compiledFor(el).start;
                if (Number.isFinite(start)) music.seek(start);
              }}
              title="Double-click to jump to its start"
            >
              <span className={`sb-src ${ref.source}`}>{ref.source === 'osb' ? 'osb' : 'diff'}</span>
              <span className="sb-layer">{el.layer.slice(0, 2)}</span>
              <span className="sb-name">{elementLabel(el)}</span>
            </li>
          );
        })}
        {total > rows.length && <li className="muted">…{total - rows.length} more (use the filters)</li>}
        {total === 0 && <li className="muted">No storyboard elements{layer !== 'all' || query || onlyVisible ? ' match' : ' yet'}.</li>}
      </ul>
      {ed.rev >= 0 && null}
    </section>
  );
}

function ElementProps({ images, sounds }: { images: string[]; sounds: string[] }) {
  useEditor();
  const ref = design.selected;
  const el = design.selectedElement;
  if (!ref || !el) return null;
  const edit = (fn: (e: SbElement) => void) => design.editSelected(fn);
  const fileOptions = (list: string[]) => (list.includes(el.file) ? list : [el.file, ...list]);
  return (
    <section className="sb-props">
      <h3>
        {el.kind === 'sample' ? 'Sample' : el.kind === 'animation' ? 'Animation' : 'Sprite'}
        <span className="muted small"> in {ref.source === 'osb' ? 'the .osb' : 'this difficulty'}</span>
      </h3>
      <div className="row wrap">
        <button className="small" onClick={() => design.duplicateSelected()} title="Ctrl+D">Duplicate</button>
        <button className="small" onClick={() => design.reorderSelected(-1)} title="Draw earlier (further back)">Back</button>
        <button className="small" onClick={() => design.reorderSelected(1)} title="Draw later (further front)">Front</button>
        <button className="small" onClick={() => design.moveSelectedToOtherSource()}>Move to {ref.source === 'osb' ? 'difficulty' : '.osb'}</button>
        <button className="small danger" onClick={() => design.deleteSelected()} title="Delete">Delete</button>
      </div>
      <div className="field">
        <span>Layer</span>
        <select value={el.layer} onChange={(e) => edit((x) => (x.layer = e.target.value as SbLayer))}>
          {(el.kind === 'sample' ? SB_LAYERS.slice(0, 4) : SB_LAYERS).map((l) => <option key={l}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <span>File</span>
        <select value={el.file} onChange={(e) => edit((x) => (x.file = e.target.value))}>
          {fileOptions(el.kind === 'sample' ? sounds : images).map((f) => <option key={f}>{f}</option>)}
        </select>
      </div>
      {el.kind === 'sample' ? (
        <>
          <NumField label="Time (ms)" value={el.time} onCommit={(v) => edit((x) => x.kind === 'sample' && (x.time = Math.round(v)))} />
          <NumField label="Volume" value={el.volume} onCommit={(v) => edit((x) => x.kind === 'sample' && (x.volume = Math.max(0, Math.min(100, v))))} />
          <button className="small" onClick={() => edit((x) => x.kind === 'sample' && (x.time = Math.round(music.time)))}>Set to current time</button>
        </>
      ) : (
        <SpriteFields el={el} />
      )}
    </section>
  );
}

function SpriteFields({ el }: { el: SbSprite }) {
  const t = useSongTime();
  const edit = (fn: (e: SbSprite) => void) => design.editSelected((x) => x.kind !== 'sample' && fn(x));
  const c = storyboard.compiledFor(el);
  const s = spriteStateAt(c, t);
  const key = (type: KeyframeType, values: number[]) => edit((x) => setKeyframe(x, type, t, values));
  const move = (x: number, y: number) => {
    const cur = { x: propValue(c, 'x', t, 0, el.x), y: propValue(c, 'y', t, 0, el.y) };
    edit((e) => setPositionAt(e, t, x, y, cur));
  };
  const hex = s ? `#${s.colour.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}` : '#ffffff';
  return (
    <>
      <div className="field">
        <span>Origin</span>
        <select value={el.origin} onChange={(e) => edit((x) => (x.origin = e.target.value as SbSprite['origin']))}>
          {SB_ORIGINS.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>
      <div className="field2">
        <NumField label="Base X" value={el.x} onCommit={(v) => edit((x) => (x.x = v))} />
        <NumField label="Base Y" value={el.y} onCommit={(v) => edit((x) => (x.y = v))} />
      </div>
      {el.kind === 'animation' && (
        <>
          <div className="field2">
            <NumField label="Frames" value={el.frameCount} onCommit={(v) => edit((x) => (x.frameCount = Math.max(1, Math.round(v))))} />
            <NumField label="Delay (ms)" value={el.frameDelay} onCommit={(v) => edit((x) => (x.frameDelay = Math.max(0, v)))} />
          </div>
          <div className="field">
            <span>Loop</span>
            <select value={el.loopForever ? 'f' : 'o'} onChange={(e) => edit((x) => (x.loopForever = e.target.value === 'f'))}>
              <option value="f">LoopForever</option>
              <option value="o">LoopOnce</option>
            </select>
          </div>
        </>
      )}
      <h4>
        At {formatTimestamp(t)} {!s && <span className="muted small">(not alive — edits still add keyframes)</span>}
      </h4>
      <div className="field2">
        <NumField label="X" value={round(propValue(c, 'x', t, 0, el.x))} onCommit={(v) => move(v, round(propValue(c, 'y', t, 0, el.y)))} />
        <NumField label="Y" value={round(propValue(c, 'y', t, 0, el.y))} onCommit={(v) => move(round(propValue(c, 'x', t, 0, el.x)), v)} />
      </div>
      <div className="field2">
        <NumField label="Scale" step={0.05} value={round(propValue(c, 'scale', t, 0, 1), 3)} onCommit={(v) => key('S', [v])} />
        <NumField label="Rotation°" value={round((propValue(c, 'rotation', t, 0, 0) * 180) / Math.PI, 1)} onCommit={(v) => key('R', [round((v * Math.PI) / 180, 4)])} />
      </div>
      <div className="field2">
        <NumField label="Vec X" step={0.05} value={round(propValue(c, 'vscale', t, 0, 1), 3)} onCommit={(v) => key('V', [v, round(propValue(c, 'vscale', t, 1, 1), 3)])} />
        <NumField label="Vec Y" step={0.05} value={round(propValue(c, 'vscale', t, 1, 1), 3)} onCommit={(v) => key('V', [round(propValue(c, 'vscale', t, 0, 1), 3), v])} />
      </div>
      <div className="field2">
        <NumField label="Opacity" step={0.05} value={round(propValue(c, 'alpha', t, 0, 1), 3)} onCommit={(v) => key('F', [Math.max(0, Math.min(1, v))])} />
        <div className="field">
          <span>Colour</span>
          <input
            type="color"
            value={hex}
            onChange={(e) => {
              const v = e.target.value;
              key('C', [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)));
            }}
          />
        </div>
      </div>
      <div className="row wrap">
        {(['H', 'V', 'A'] as const).map((p) => (
          <button key={p} className="small" onClick={() => edit((x) => x.commands.push({ type: 'P', easing: 0, start: t, end: t + beat(t), from: [], to: [], param: p }))}>
            + {p === 'H' ? 'Flip H' : p === 'V' ? 'Flip V' : 'Additive'}
          </button>
        ))}
      </div>
      <CommandList el={el} t={t} />
    </>
  );
}

function beat(t: number): number {
  const b = redLineAt(editor.bm, t).beatLength;
  return b > 0 ? Math.round(b) : 500;
}

function round(v: number, digits = 2): number {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

// ------------------------------------------------------------------ raw command list

function CommandList({ el, t }: { el: SbSprite; t: number }) {
  const [addType, setAddType] = useState<SbCommandType | 'L' | 'T'>('F');
  const edit = (fn: (e: SbSprite) => void) => design.editSelected((x) => x.kind !== 'sample' && fn(x));
  const c = storyboard.compiledFor(el);
  const s = spriteStateAt(c, t);
  const currentValues = (type: SbCommandType): number[] => {
    if (!s) return type === 'C' ? [255, 255, 255] : type === 'M' ? [el.x, el.y] : type === 'F' || type === 'S' ? [1] : type === 'V' ? [1, 1] : [0];
    switch (type) {
      case 'F': return [round(s.alpha, 3)];
      case 'M': return [round(s.x), round(s.y)];
      case 'MX': return [round(s.x)];
      case 'MY': return [round(s.y)];
      case 'S': return [round(propValue(c, 'scale', t, 0, 1), 3)];
      case 'V': return [round(propValue(c, 'vscale', t, 0, 1), 3), round(propValue(c, 'vscale', t, 1, 1), 3)];
      case 'R': return [round(s.rotation, 4)];
      case 'C': return s.colour.map((v) => Math.round(v));
      default: return [];
    }
  };
  const add = () => {
    const tt = Math.round(t);
    edit((x) => {
      if (addType === 'L') x.commands.push({ type: 'L', start: tt, count: 2, commands: [{ type: 'F', easing: 0, start: 0, end: beat(t), from: [1], to: [0] }] });
      else if (addType === 'T') x.commands.push({ type: 'T', trigger: 'HitSoundClap', start: tt, end: tt + beat(t) * 16, group: 0, commands: [{ type: 'F', easing: 0, start: 0, end: beat(t), from: [1], to: [0] }] });
      else if (addType === 'P') x.commands.push({ type: 'P', easing: 0, start: tt, end: tt + beat(t), from: [], to: [], param: 'H' });
      else {
        const v = currentValues(addType);
        x.commands.push({ type: addType, easing: 0, start: tt, end: tt + beat(t), from: v, to: v.slice() });
      }
    });
  };
  return (
    <div className="sb-commands">
      <h4>Commands</h4>
      <div className="row">
        <select value={addType} onChange={(e) => setAddType(e.target.value as SbCommandType)}>
          {(Object.keys(SB_COMMAND_NAMES) as SbCommandType[]).map((k) => <option key={k} value={k}>{k} – {SB_COMMAND_NAMES[k]}</option>)}
          <option value="L">L – Loop</option>
          <option value="T">T – Trigger</option>
        </select>
        <button className="small" onClick={add}>Add at current time</button>
      </div>
      <table className="sb-cmd-table">
        <tbody>
          {el.commands.map((entry, i) => (
            <EntryRows key={i} entry={entry} onChange={(fn) => edit((x) => fn(x.commands[i]))} onDelete={() => edit((x) => x.commands.splice(i, 1))} />
          ))}
        </tbody>
      </table>
      {el.commands.length === 0 && <p className="muted small">No commands: the sprite is never shown.</p>}
    </div>
  );
}

function EntryRows({ entry, onChange, onDelete }: { entry: SbEntry; onChange: (fn: (e: SbEntry) => void) => void; onDelete: () => void }) {
  if (entry.type === 'L' || entry.type === 'T') {
    const g = entry;
    return (
      <>
        <tr className="group">
          <td>{g.type}</td>
          <td colSpan={4}>
            {g.type === 'T' && (
              <TextCell value={g.trigger} width={110} onCommit={(v) => onChange((e) => e.type === 'T' && (e.trigger = v))} />
            )}
            <NumCell value={g.start} title="Start time" onCommit={(v) => onChange((e) => e.type !== 'L' && e.type !== 'T' ? undefined : (e.start = Math.round(v)))} />
            {g.type === 'L' ? (
              <> × <NumCell value={g.count} title="Loop count" onCommit={(v) => onChange((e) => e.type === 'L' && (e.count = Math.max(1, Math.round(v))))} /></>
            ) : (
              <> – <NumCell value={g.end} title="End time" onCommit={(v) => onChange((e) => e.type === 'T' && (e.end = Math.round(v)))} /></>
            )}
            <button className="small" title="Add a fade inside" onClick={() => onChange((e) => (e.type === 'L' || e.type === 'T') && e.commands.push({ type: 'F', easing: 0, start: 0, end: 500, from: [1], to: [0] }))}>+</button>
          </td>
          <td><button className="small danger" onClick={onDelete}>×</button></td>
        </tr>
        {g.commands.map((c, j) => (
          <CommandRow
            key={j}
            cmd={c}
            nested
            onChange={(fn) => onChange((e) => (e.type === 'L' || e.type === 'T') && fn(e.commands[j]))}
            onDelete={() => onChange((e) => (e.type === 'L' || e.type === 'T') && e.commands.splice(j, 1))}
          />
        ))}
      </>
    );
  }
  return <CommandRow cmd={entry} onChange={(fn) => onChange((e) => fn(e as SbCommand))} onDelete={onDelete} />;
}

function CommandRow({ cmd, nested, onChange, onDelete }: { cmd: SbCommand; nested?: boolean; onChange: (fn: (c: SbCommand) => void) => void; onDelete: () => void }) {
  const arity = SB_COMMAND_ARITY[cmd.type];
  const parseList = (s: string) => {
    const v = s.split(/[\s,]+/).filter(Boolean).map(Number);
    return v.length === arity && v.every(Number.isFinite) ? v : null;
  };
  return (
    <tr className={nested ? 'nested' : ''}>
      <td title={SB_COMMAND_NAMES[cmd.type]}>{nested ? '↳ ' : ''}{cmd.type}</td>
      <td>
        <select value={cmd.easing} onChange={(e) => onChange((c) => (c.easing = Number(e.target.value)))} title="Easing">
          {EASING_NAMES.map((n, i) => <option key={i} value={i}>{i} {n}</option>)}
        </select>
      </td>
      <td>
        <NumCell value={cmd.start} title="Start time" onCommit={(v) => onChange((c) => { const d = c.end - c.start; c.start = Math.round(v); if (c.end < c.start) c.end = c.start + d; })} />
        <NumCell value={cmd.end} title="End time" onCommit={(v) => onChange((c) => (c.end = Math.max(c.start, Math.round(v))))} />
      </td>
      {cmd.type === 'P' ? (
        <td colSpan={2}>
          <select value={cmd.param} onChange={(e) => onChange((c) => (c.param = e.target.value as 'H' | 'V' | 'A'))}>
            <option value="H">H flip</option>
            <option value="V">V flip</option>
            <option value="A">Additive</option>
          </select>
        </td>
      ) : (
        <>
          <td><TextCell value={cmd.from.join(',')} title="Start value" onCommit={(v) => { const l = parseList(v); if (l) onChange((c) => (c.from = l)); }} /></td>
          <td><TextCell value={cmd.to.join(',')} title="End value" onCommit={(v) => { const l = parseList(v); if (l) onChange((c) => (c.to = l)); }} /></td>
        </>
      )}
      <td><button className="small danger" onClick={onDelete}>×</button></td>
    </tr>
  );
}

// ------------------------------------------------------------------ inputs that commit on blur / Enter

function CommitInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      {...rest}
      value={text}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        else if (e.key === 'Escape') {
          setText(value);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function NumField({ label, value, onCommit, step }: { label: string; value: number; onCommit: (v: number) => void; step?: number }): ReactNode {
  return (
    <div className="field">
      <span>{label}</span>
      <CommitInput type="number" step={step ?? 1} value={String(value)} onCommit={(v) => Number.isFinite(Number(v)) && v.trim() !== '' && onCommit(Number(v))} />
    </div>
  );
}

function NumCell({ value, onCommit, title }: { value: number; onCommit: (v: number) => void; title?: string }) {
  return <CommitInput className="cell num" title={title} value={String(value)} onCommit={(v) => Number.isFinite(Number(v)) && v.trim() !== '' && onCommit(Number(v))} />;
}

function TextCell({ value, onCommit, title, width }: { value: string; onCommit: (v: string) => void; title?: string; width?: number }) {
  return <CommitInput className="cell" title={title} style={width ? { width } : undefined} value={value} onCommit={onCommit} />;
}

// ------------------------------------------------------------------ raw script

function ScriptPanel() {
  const ed = useEditor();
  const project = ed.project!;
  storyboard.sync();
  const osbName = storyboard.osbName;
  const blob = project.files.get(osbName);
  const [osb, setOsb] = useState('');
  const [diffSb, setDiffSb] = useState(ed.bm.events.storyboardLines.join('\n'));

  useEffect(() => {
    if (blob) void blob.text().then(setOsb);
    else setOsb('[Events]\n//Background and Video events\n//Storyboard Layer 0 (Background)\n//Storyboard Layer 1 (Fail)\n//Storyboard Layer 2 (Pass)\n//Storyboard Layer 3 (Foreground)\n//Storyboard Layer 4 (Overlay)\n//Storyboard Sound Samples\n');
  }, [blob]);

  useEffect(() => setDiffSb(ed.bm.events.storyboardLines.join('\n')), [ed.diffIndex, ed.bm, ed.bm.events.storyboardLines]);

  return (
    <div className="design-panel script">
      <h3>Shared storyboard <span className="muted small">{osbName}</span></h3>
      <textarea spellCheck={false} value={osb} onChange={(e) => setOsb(e.target.value)} />
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            editor.setFile(osbName, new Blob([osb.replace(/\r?\n/g, '\r\n')], { type: 'text/plain' }));
            design.select(null);
            editor.toast(`Saved ${osbName}`);
          }}
        >
          Apply .osb
        </button>
      </div>
      <h3>This difficulty's storyboard <span className="muted small">([Events] in the .osu)</span></h3>
      <textarea spellCheck={false} value={diffSb} onChange={(e) => setDiffSb(e.target.value)} />
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            editor.commit((bm) => {
              bm.events.storyboardLines = diffSb.split(/\r?\n/).filter((l) => l.trim().length > 0);
            });
            design.select(null);
          }}
        >
          Apply difficulty storyboard
        </button>
      </div>
      <h3>Quick reference</h3>
      <pre className="sb-ref">{`Sprite,<layer>,<origin>,"<file>",<x>,<y>
Animation,<layer>,<origin>,"<file>",<x>,<y>,<frames>,<delay>,<LoopForever|LoopOnce>
 F,<easing>,<start>,<end>,<opacity1>,<opacity2>
 M,<easing>,<start>,<end>,<x1>,<y1>,<x2>,<y2>
 S / V / R / C / MX / MY / P
 L,<start>,<loopcount>   T,<trigger>,<start>,<end>
Sample,<time>,<layer>,"<file>",<volume>
Origins: ${Object.keys(ORIGIN_ANCHOR).join(', ')}`}</pre>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { music } from '../../audio/music';
import { fmt } from '../../osu/info';
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
import { StdPlayfield } from '../playfield/stdPlayfield';
import { layoutCode } from '../shortcuts';
import { editor, formatTimestamp, useEditor } from '../store';
import { design, keyframeStyle, setKeyframe, setPositionAt, type KeyframeType } from '../storyboard/design';
import { fitFrame, SB_H, SB_W, SB_WIDE_MARGIN, storyboard, type SbFrame, type SbRef, type SbSource } from '../storyboard/runtime';
import { drawBackground } from './Playfield';
import { canvasDpr } from '../../ui/touch';

const IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp)$/i;
const SOUND_RE = /\.(wav|ogg|mp3)$/i;

/** Cursor in storyboard coordinates, for the top-right readout. */
const cursor = { x: 0, y: 0, inside: false };

/**
 * F2 design mode laid out like stable: the storyboard fills the stage, the left panel holds layer toggles and
 * keyframing options, and the top timeline shows the selected sprite's keyframes. Clicking and dragging a sprite
 * keyframes it at the current time. The sprite library (I) holds element/command editing and the raw script.
 */
export function DesignScreen() {
  const ed = useEditor();
  const [library, setLibrary] = useState(false);
  const [tab, setTab] = useState<'visual' | 'script'>('visual');

  useEffect(() => {
    storyboard.layers = SB_LAYERS.filter((l) => design.visibleLayers.has(l));
  }, [ed.rev]);
  useEffect(() => () => void (storyboard.layers = null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (editor.dialog || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || e.ctrlKey || e.altKey) return;
      const code = layoutCode(e);
      if (code === 'KeyI') setLibrary((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="dz">
      <SbPreview />
      <DesignLeft />
      <KeyframeControl />
      <LayerList />
      <button className={`dz-library-btn ${library ? 'on' : ''}`} onClick={() => setLibrary(!library)} title="Sprite Library (I)">
        Sprite<br />Library
      </button>
      {library && (
        <div className="dz-drawer design-side">
          <div className="tabs">
            <button className={tab === 'visual' ? 'active' : ''} onClick={() => setTab('visual')}>Sprites</button>
            <button className={tab === 'script' ? 'active' : ''} onClick={() => setTab('script')}>Script</button>
            <button className="dz-drawer-close" onClick={() => setLibrary(false)} aria-label="Close">✕</button>
          </div>
          {tab === 'visual' ? <VisualPanel /> : <ScriptPanel />}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ left panel

function Dot({ on, label, onClick, title }: { on: boolean; label: string; onClick: () => void; title?: string }) {
  return (
    <button className={`dz-opt ${on ? 'on' : ''}`} onClick={onClick} title={title}>
      <span className="dz-dot" /> {label}
    </button>
  );
}

function DesignLeft() {
  const ed = useEditor();
  const toggleLayer = (l: SbLayer) => {
    if (design.visibleLayers.has(l)) design.visibleLayers.delete(l);
    else design.visibleLayers.add(l);
    ed.emit();
  };
  const set = (fn: () => void) => {
    fn();
    ed.emit();
  };
  const layerLabels: [SbLayer, string][] = [['Background', 'Background'], ['Fail', 'Failing'], ['Pass', 'Passing'], ['Foreground', 'Foreground'], ['Overlay', 'Overlay']];
  return (
    <div className="dz-left">
      <div className="dz-head">Layer Toggles</div>
      {layerLabels.map(([l, label]) => <Dot key={l} on={design.visibleLayers.has(l)} label={label} onClick={() => toggleLayer(l)} />)}
      <Dot on={design.showHitObjects} label="HitObjects" onClick={() => set(() => (design.showHitObjects = !design.showHitObjects))} />
      <div className="dz-head">Transformation</div>
      {(['move', 'scale', 'fade', 'rotate', 'colour'] as const).map((t) => (
        <Dot key={t} on={design.transform === t} label={t[0].toUpperCase() + t.slice(1)} onClick={() => set(() => (design.transform = t))} title={t === 'colour' ? 'Click a sprite to pick its colour at the current time' : `Drag a sprite to ${t} it at the current time`} />
      ))}
      <div className="dz-head">Tweening</div>
      <Dot on={keyframeStyle.tween} label="Enabled" onClick={() => set(() => (keyframeStyle.tween = !keyframeStyle.tween))} title="New keyframes ease from the previous one" />
      <div className="dz-head">Easing</div>
      <Dot on={keyframeStyle.easing === 2} label="In" onClick={() => set(() => (keyframeStyle.easing = keyframeStyle.easing === 2 ? 0 : 2))} />
      <Dot on={keyframeStyle.easing === 1} label="Out" onClick={() => set(() => (keyframeStyle.easing = keyframeStyle.easing === 1 ? 0 : 1))} />
      <div className="dz-head">Origin</div>
      <Dot on={design.newOrigin === 'TopLeft'} label="Top-Left" onClick={() => set(() => (design.newOrigin = 'TopLeft'))} title="Origin of new sprites" />
      <Dot on={design.newOrigin === 'Centre'} label="Centre" onClick={() => set(() => (design.newOrigin = 'Centre'))} title="Origin of new sprites" />
      <div className="dz-head">Advanced</div>
      <Dot on={design.target === 'diff'} label="Diff. Specific" onClick={() => set(() => (design.target = design.target === 'diff' ? 'osb' : 'diff'))} title="New sprites go into this difficulty instead of the shared .osb" />
    </div>
  );
}

function KeyframeControl() {
  useEditor();
  const has = !!design.selectedElement && design.selectedElement.kind !== 'sample';
  return (
    <div className="dz-keyframes">
      <span className="dz-order">
        <button onClick={() => design.reorderSelected(-1)} disabled={!has} title="Draw further back">▼</button>
        <button onClick={() => design.reorderSelected(1)} disabled={!has} title="Draw further front">▲</button>
      </span>
      <span className="dz-kf-label">Keyframe Control</span>
      <button onClick={() => design.addKeyframe()} disabled={!has} title="Add a keyframe at the current time">+</button>
      <button onClick={() => design.removeKeyframe()} disabled={!has} title="Remove the keyframe at the current time">−</button>
      <button onClick={() => design.seekKeyframe(-1)} disabled={!has} title="Previous keyframe">⏮</button>
      <button onClick={() => design.seekKeyframe(1)} disabled={!has} title="Next keyframe">⏭</button>
    </div>
  );
}

/** Right-hand layer list: the selected sprite's layer, click to move it. */
function LayerList() {
  useEditor();
  const el = design.selectedElement;
  return (
    <div className="dz-layers">
      {SB_LAYERS.map((l) => (
        <button key={l} className={el?.layer === l ? 'on' : ''} disabled={!el} onClick={() => design.editSelected((x) => (x.layer = l))}>{l}</button>
      ))}
    </div>
  );
}

/** Top right of the design view: background toggle and cursor/time/SB load readout. */
export function DesignTopRight() {
  const ed = useEditor();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let last = 0;
    let load = 0;
    return onFrame((t) => {
      const el = ref.current;
      if (!el || !editor.hasProject) return;
      const now = performance.now();
      if (now - last > 250) {
        last = now;
        load = sbLoad(t);
      }
      el.textContent = `${cursor.inside ? `x:${Math.round(cursor.x)} y:${Math.round(cursor.y)}` : ''}\n${fmt(Math.round(t), 0)}ms\n\nSB Load: ${fmt(load, 2)}x`;
    });
  }, []);
  return (
    <>
      <button className={`dz-bg-btn ${design.showBackground ? 'on' : ''}`} onClick={() => { design.showBackground = !design.showBackground; ed.emit(); }} title="Show the background image and video behind the storyboard">
        Background Image/Video
      </button>
      <div className="dz-readout" ref={ref} />
    </>
  );
}

/** Rough storyboard load: total area of visible sprites relative to the 640x480 screen. */
function sbLoad(t: number): number {
  let area = 0;
  for (const { el } of storyboard.drawOrder()) {
    const c = storyboard.compiledFor(el);
    const s = spriteStateAt(c, t);
    if (!s || s.alpha <= 0.001) continue;
    const fi = storyboard.frameImage(c, t);
    if (!fi) continue;
    area += Math.abs(fi.img.naturalWidth * s.scaleX * fi.img.naturalHeight * s.scaleY);
  }
  return area / (SB_W * SB_H);
}

// ------------------------------------------------------------------ top timeline: the selected sprite's keyframes

const LANES: { label: string; props: Prop[]; colour: string }[] = [
  { label: 'Movement', props: ['x', 'y'], colour: '#66b8ff' },
  { label: 'Scale', props: ['scale', 'vscale'], colour: '#7ad97a' },
  { label: 'Fade', props: ['alpha'], colour: '#d0d0d0' },
  { label: 'Rotation', props: ['rotation'], colour: '#ffcc55' },
];

export function DesignTimeline() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0;
    let h = 0;
    const ro = new ResizeObserver(() => {
      const dpr = canvasDpr();
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    ro.observe(canvas);
    const ppm = () => (w / 5000) * (editor.hasProject ? editor.bm.editor.timelineZoom : 1);
    const off = onFrame((t) => {
      if (!w || !editor.hasProject) return;
      const k = ppm();
      const X = (time: number) => w / 2 + (time - t) * k;
      ctx.clearRect(0, 0, w, h);
      const lane = (h - 4) / LANES.length;
      // Beat ticks along the bottom.
      const red = redLineAt(editor.bm, t);
      if (red.beatLength > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        const t0 = t - w / 2 / k;
        for (let n = Math.ceil((t0 - red.time) / red.beatLength); ; n++) {
          const bt = red.time + n * red.beatLength;
          const x = X(bt);
          if (x > w) break;
          ctx.fillRect(x, h - (n % red.meter === 0 ? 7 : 4), 1, n % red.meter === 0 ? 7 : 4);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(0, h - 1, w, 1);
      ctx.font = `700 ${Math.max(9, lane * 0.62)}px Ubuntu, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'middle';
      const el = design.selectedElement;
      LANES.forEach((ln, i) => {
        const y = i * lane;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(0, y + lane - 1, w, 1);
        if (el && el.kind !== 'sample') {
          const c = storyboard.compiledFor(el);
          for (const p of ln.props) {
            for (const s of c.timelines[p] ?? []) {
              const a = X(s.start);
              const b = X(s.end);
              if (b < -10 || a > w + 10) continue;
              ctx.fillStyle = ln.colour;
              ctx.globalAlpha = 0.45;
              ctx.fillRect(a, y + lane * 0.3, Math.max(1, b - a), lane * 0.4);
              ctx.globalAlpha = 1;
              for (const x of [a, b]) {
                ctx.beginPath();
                ctx.arc(x, y + lane / 2, lane * 0.28, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        }
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(ln.label, 2, y + lane / 2);
        ctx.shadowBlur = 0;
      });
      ctx.fillStyle = '#fff';
      ctx.fillRect(w / 2 - 1, 0, 2, h);
    });
    const down = (e: PointerEvent) => {
      if (!editor.hasProject) return;
      const r = canvas.getBoundingClientRect();
      music.seek(Math.max(0, music.time + (e.clientX - r.left - w / 2) / ppm()));
    };
    canvas.addEventListener('pointerdown', down);
    return () => {
      off();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
    };
  }, []);
  return <canvas ref={ref} className="timeline-canvas" data-wheel="timeline" />;
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
        const tNow = performance.now();
        if (music.playing && tNow - last.current.at < intervalWhilePlaying) return;
        last.current = { t: r, at: tNow };
        setT(r);
      }),
    [intervalWhilePlaying],
  );
  return t;
}

function SbPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colourRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const objects = new StdPlayfield();
    let w = 0;
    let h = 0;
    let frame: SbFrame = { ox: 0, oy: 0, scale: 1 };
    let hover: SbRef | null = null;
    const ro = new ResizeObserver(() => {
      const dpr = canvasDpr();
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
      drawBackground(ctx, w, h, 0, t, { frame, storyboard: true, background: design.showBackground });
      const X = (x: number) => frame.ox + x * frame.scale;
      const Y = (y: number) => frame.oy + y * frame.scale;
      ctx.save();
      // Darken what the game wouldn't show.
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const m = wide ? SB_WIDE_MARGIN : 0;
      ctx.fillRect(0, 0, X(-m), h);
      ctx.fillRect(X(SB_W + m), 0, w - X(SB_W + m), h);
      ctx.restore();
      if (design.showHitObjects && editor.bm.general.mode === 0) {
        objects.draw(ctx, { scale: frame.scale, ox: X(64), oy: Y(56) }, t);
      }
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
      if (design.transform === 'colour' && !e.shiftKey && !e.ctrlKey) {
        const el = storyboard.get(ref);
        if (el && el.kind !== 'sample' && colourRef.current) {
          const s = spriteStateAt(storyboard.compiledFor(el), t);
          const c = s?.colour ?? [255, 255, 255];
          colourRef.current.value = `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
          colourRef.current.click();
        }
        return;
      }
      const mode = e.shiftKey ? 'scale' : e.ctrlKey || e.altKey ? 'rotate' : design.transform === 'colour' ? 'move' : design.transform;
      design.beginDrag(ref, p, mode);
    };
    const move = (e: PointerEvent) => {
      const p = toSb(e);
      cursor.x = p.x;
      cursor.y = p.y;
      cursor.inside = true;
      if (design.dragging) design.dragTo(p);
      else hover = storyboard.hitTest(p, music.time);
    };
    const leave = () => (cursor.inside = false);
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
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dragover', over);
    canvas.addEventListener('drop', drop);
    return () => {
      off();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('dragover', over);
      canvas.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="dz-canvas" data-wheel="playfield" />
      <input
        ref={colourRef}
        type="color"
        className="dz-colour-input"
        onChange={(e) => {
          const v = e.target.value;
          const rgb = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
          design.editSelected((x) => x.kind !== 'sample' && setKeyframe(x, 'C', Math.round(music.time), rgb));
        }}
      />
    </>
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

// Toolbox and toggle icons drawn as SVG in the spirit of stable's default skin (not copies of its sprites).
import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 64 64" aria-hidden className="ico">{children}</svg>
);

export const SelectIcon = () => (
  <Svg>
    <rect x="12" y="10" width="34" height="34" rx="3" transform="rotate(20 29 27)" fill="none" stroke="#4ab4ff" strokeWidth="4" strokeDasharray="7 6" />
    <path d="M36 32 L36 58 L42 52 L47 62 L52 59 L47 50 L56 50 Z" fill="#fff" stroke="#222" strokeWidth="1.5" />
  </Svg>
);

export const CircleIcon = () => (
  <Svg>
    <circle cx="32" cy="32" r="25" fill="none" stroke="#6fb8e8" strokeWidth="2" />
    <circle cx="32" cy="32" r="20" fill="#9a9a9a" stroke="#ddd" strokeWidth="3" />
  </Svg>
);

export const SliderIcon = () => (
  <Svg>
    <path d="M14 50 L50 14" stroke="#3e8fd6" strokeWidth="14" strokeLinecap="round" />
    <path d="M14 50 L50 14" stroke="#64b4f0" strokeWidth="8" strokeLinecap="round" strokeDasharray="3 7" />
    <circle cx="14" cy="50" r="8" fill="#bbb" stroke="#fff" strokeWidth="2" />
    <circle cx="50" cy="14" r="8" fill="#ddd" stroke="#fff" strokeWidth="2" />
  </Svg>
);

export const SpinnerIcon = () => (
  <Svg>
    <circle cx="32" cy="32" r="26" fill="none" stroke="#2f8be0" strokeWidth="4" />
    <path d="M32 32 m0 -4 a4 4 0 1 1 -4 4 a8 8 0 0 1 8 -8 a12 12 0 0 1 12 12 a16 16 0 0 1 -16 16 a20 20 0 0 1 -20 -20" fill="none" stroke="#5ab0ff" strokeWidth="4" strokeLinecap="round" />
  </Svg>
);

export const NewComboIcon = () => (
  <Svg>
    <circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" strokeWidth="5" />
    <circle cx="32" cy="32" r="8" fill="currentColor" opacity="0.4" />
  </Svg>
);

export const WhistleIcon = () => (
  <Svg>
    <path d="M8 26 h26 a12 12 0 1 1 -12 12 h-14 z" fill="currentColor" />
    <circle cx="34" cy="38" r="5" fill="#333" />
    <path d="M44 16 q6 -6 12 0 M46 22 q4 -3 8 0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </Svg>
);

export const FinishIcon = () => (
  <Svg>
    <ellipse cx="30" cy="30" rx="24" ry="9" transform="rotate(-20 30 30)" fill="currentColor" />
    <path d="M30 30 L40 58" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <path d="M50 10 q7 3 8 10 M46 6 q11 3 14 15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </Svg>
);

export const ClapIcon = () => (
  <Svg>
    <path d="M18 40 q-6 -14 6 -26 l8 -6 q4 -2 5 2 l-6 10 l14 -12 q4 -2 5 2 l-13 14 l14 -9 q4 -1 4 3 l-14 12 l10 -5 q4 0 3 4 q-10 10 -20 14 q-10 3 -16 -3z" fill="currentColor" />
    <path d="M8 22 q-2 -8 4 -12 M4 30 q-3 -12 4 -19" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </Svg>
);

export const GridSnapIcon = () => (
  <Svg>
    <path d="M10 22 H54 M10 42 H54 M22 10 V54 M42 10 V54" stroke="currentColor" strokeWidth="2.5" opacity="0.7" />
    <circle cx="42" cy="22" r="8" fill="none" stroke="currentColor" strokeWidth="4" />
  </Svg>
);

export const DistanceSnapIcon = () => (
  <Svg>
    <circle cx="10" cy="40" r="7" fill="none" stroke="currentColor" strokeWidth="4" />
    <circle cx="54" cy="40" r="7" fill="none" stroke="currentColor" strokeWidth="4" />
    <path d="M17 40 H47" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
    <path d="M34 36 V14 l10 4" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    <ellipse cx="30" cy="37" rx="5" ry="4" fill="currentColor" />
  </Svg>
);

export const LockIcon = () => (
  <Svg>
    <circle cx="28" cy="30" r="18" fill="none" stroke="currentColor" strokeWidth="5" />
    <rect x="38" y="40" width="18" height="15" rx="2" fill="#2a76c6" />
    <path d="M42 40 v-5 a5 5 0 0 1 10 0 v5" fill="none" stroke="#2a76c6" strokeWidth="3" />
  </Svg>
);

export const PlayIcon = () => <svg viewBox="0 0 24 24" className="tico"><path d="M5 3 L21 12 L5 21 Z" fill="currentColor" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 24 24" className="tico"><path d="M5 3 h5 v18 h-5z M14 3 h5 v18 h-5z" fill="currentColor" /></svg>;
export const StopIcon = () => <svg viewBox="0 0 24 24" className="tico"><path d="M4 4 h16 v16 h-16z" fill="currentColor" /></svg>;
export const TestIcon = () => <svg viewBox="0 0 30 24" className="tico"><rect x="1" y="4" width="17" height="16" rx="3" fill="currentColor" /><path d="M19 12 L29 4 V20 Z" fill="currentColor" /></svg>;
export const PlusIcon = () => <svg viewBox="0 0 24 24" className="zico"><circle cx="12" cy="12" r="11" fill="#fff" /><path d="M6 12 h12 M12 6 v12" stroke="#000" strokeWidth="3" /></svg>;
export const MinusIcon = () => <svg viewBox="0 0 24 24" className="zico"><circle cx="12" cy="12" r="11" fill="#fff" /><path d="M6 12 h12" stroke="#000" strokeWidth="3" /></svg>;

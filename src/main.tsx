import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installShortcuts } from './editor/shortcuts';
import './editor/playback';
import './styles.css';

installShortcuts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

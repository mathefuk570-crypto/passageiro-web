import React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PwaControls from './components/PwaControls';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App /><PwaControls />
  </StrictMode>,
);
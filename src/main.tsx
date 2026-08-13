import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installDevEncoderMock } from './dev-encoder-mock';
import './styles.css';

if (import.meta.env.DEV && !window.encoder) installDevEncoderMock();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

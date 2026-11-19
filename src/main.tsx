import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { blockPageZoom, registerServiceWorker } from './state/pwa'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Modo offline: solo en producción (en desarrollo el SW cachearía módulos de Vite).
if (import.meta.env.PROD) registerServiceWorker()
blockPageZoom()

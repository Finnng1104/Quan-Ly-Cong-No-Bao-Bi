import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { installErrorReporting } from './api/errorReporting'
import { registerSW } from 'virtual:pwa-register'

installErrorReporting()
// With autoUpdate this reloads the page once a new service worker takes over. Without it the
// shop kept seeing the previously cached app after an update until every tab was closed.
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)

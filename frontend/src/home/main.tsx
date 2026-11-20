import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './home.css'
import { AuthProvider } from '../AuthProvider.tsx'
import HomeApp from './HomeApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <HomeApp />
    </AuthProvider>
  </StrictMode>,
)

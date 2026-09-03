import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { assetUrl } from './assetUrl'
import './styles.css'

document.documentElement.style.setProperty(
  '--hex-bg-pattern',
  `url('${assetUrl('brand/blackBackgroundPattern.jpg')}')`,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

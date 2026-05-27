import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import DatasetsPage from './pages/DatasetsPage'
import DashboardPage from './pages/DashboardPage'
import InvestigatePage from './pages/InvestigatePage'
import './index.css'

function Nav() {
  const datasetId = sessionStorage.getItem('dataset_id') || ''
  return (
    <nav style={{
      display: 'flex', alignItems: 'center', gap: 40,
      padding: '0 32px', height: 56,
      background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
      position: 'sticky', top: 0, zIndex: 100
    }}>
      <a href="/intro.html" style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', fontSize: 14, letterSpacing: 3, textDecoration: 'none', cursor: 'pointer' }}>
        ◈ SHADOW<span style={{ color: 'var(--text2)' }}>HUNTER</span>
      </a>
      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
        {[
          ['DATASETS', '/app'],
          ['DASHBOARD', datasetId ? `/app/dashboard?dataset_id=${datasetId}` : '/app/dashboard'],
          ['INVESTIGATE', '/app/investigate']
        ].map(([label, path]) => (
          <NavLink key={label} to={path} end={label === 'DATASETS'}
            style={({ isActive }) => ({
              fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: 2,
              padding: '6px 16px', textDecoration: 'none',
              border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              color: isActive ? 'var(--accent)' : 'var(--text2)',
              transition: 'all 0.2s'
            })}>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/app" element={<DatasetsPage />} />
        <Route path="/app/dashboard" element={<DashboardPage />} />
        <Route path="/app/investigate" element={<InvestigatePage />} />
        <Route path="*" element={<DatasetsPage />} />
      </Routes>
    </BrowserRouter>
  )
}
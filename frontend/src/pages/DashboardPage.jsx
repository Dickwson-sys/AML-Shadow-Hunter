import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getStats, getAlerts, getTopSuspicious } from '../api'

// Count-up hook
function useCountUp(target, duration=1500, active=false) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!active || !target) return
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const ease = 1 - Math.pow(1 - t, 3)
      setVal(Math.floor(target * ease))
      if (t < 1) requestAnimationFrame(tick)
      else setVal(target)
    }
    requestAnimationFrame(tick)
  }, [target, active])
  return val
}

function StatCard({ label, target, color, active }) {
  const val = useCountUp(target, 1800, active)
  return (
    <div className="card" style={{ textAlign:'center' }}>
      <div className="tag" style={{ marginBottom:8 }}>{label}</div>
      <div style={{ fontFamily:'var(--mono)', fontSize:32, color, transition:'color 0.3s' }}>
        {val?.toLocaleString()}
      </div>
    </div>
  )
}

const RiskBar = ({ score, animate }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
    <div style={{ flex:1, height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
      <div style={{
        width: animate ? `${score*100}%` : '0%',
        height:'100%', borderRadius:2,
        transition:'width 1.2s cubic-bezier(0.4,0,0.2,1)',
        background:score>0.85?'var(--accent)':score>0.7?'var(--yellow)':'var(--green)'
      }} />
    </div>
    <span style={{ fontFamily:'var(--mono)', fontSize:10, color:score>0.85?'var(--accent)':'var(--yellow)', minWidth:36 }}>
      {(score*100).toFixed(0)}%
    </span>
  </div>
)

// Typing text component
function TypingText({ text, speed=40, color='var(--green)' }) {
  const [displayed, setDisplayed] = useState('')
  useEffect(() => {
    setDisplayed('')
    let i = 0
    const iv = setInterval(() => {
      setDisplayed(text.slice(0, ++i))
      if (i >= text.length) clearInterval(iv)
    }, speed)
    return () => clearInterval(iv)
  }, [text])
  return (
    <span style={{ fontFamily:'var(--mono)', color, fontSize:10 }}>
      {displayed}<span style={{ animation:'blink 0.7s step-end infinite', display:'inline-block', width:2, height:'1em', background:color, verticalAlign:'middle', marginLeft:1 }} />
    </span>
  )
}

export default function DashboardPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const datasetId = params.get('dataset_id')
  const [stats, setStats] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [topAccounts, setTopAccounts] = useState([])
  const [threshold, setThreshold] = useState(0.7)
  const [loaded, setLoaded] = useState(false)
  const [barsReady, setBarsReady] = useState(false)

  useEffect(() => {
    if (!datasetId) return
    setLoaded(false)
    setBarsReady(false)
    Promise.all([
      getStats(datasetId),
      getAlerts(datasetId, threshold),
      getTopSuspicious(datasetId, threshold)
    ]).then(([s, a, t]) => {
      setStats(s.data)
      setAlerts(a.data)
      setTopAccounts(t.data)
      setLoaded(true)
      setTimeout(() => setBarsReady(true), 300)
    })
  }, [datasetId, threshold])

  const handleAlertClick = (a) => {
    sessionStorage.setItem('dataset_id', datasetId)
    const p = new URLSearchParams({
      account_id: a.sender, dataset_id: datasetId,
      from_country: a.from_country || '', to_country: a.to_country || '',
      from_lat: a.from_lat || '40.7', from_lon: a.from_lon || '-74.0',
      to_lat: a.to_lat || '51.5', to_lon: a.to_lon || '-0.1',
    })
    navigate(`/app/investigate?${p.toString()}`)
  }

  if (!datasetId) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'calc(100vh - 56px)', flexDirection:'column', gap:16 }}>
      <div style={{ fontFamily:'var(--mono)', color:'var(--text2)' }}>No dataset selected.</div>
      <button className="btn" onClick={() => navigate('/app')}>GO TO DATASETS</button>
    </div>
  )

  return (
    <div style={{ padding:32 }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-12px)} to{opacity:1;transform:translateX(0)} }
      `}</style>

      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:24 }}>
        <div className="tag" style={{ color:'var(--accent)' }}>◈ THREAT DASHBOARD</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--text2)', marginLeft:'auto' }}>
          DATASET:{' '}
          {loaded
            ? <TypingText text={datasetId} speed={60} color='var(--green)' />
            : <span style={{ color:'var(--green)' }}>{datasetId}</span>
          }
        </div>
      </div>

      {/* Stats with count-up */}
      {stats && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16, marginBottom:24 }}>
          <StatCard label="TOTAL ACCOUNTS" target={stats.total_accounts} color="var(--text)" active={loaded} />
          <StatCard label="TRANSACTIONS" target={stats.transaction_count} color="var(--text)" active={loaded} />
          <StatCard label="FLAGGED" target={stats.flagged_count} color="var(--accent)" active={loaded} />
        </div>
      )}

      {/* Top Suspicious Accounts */}
      {topAccounts.length > 0 && (
        <div className="card" style={{ marginBottom:24 }}>
          <div className="tag" style={{ marginBottom:12, color:'var(--accent)' }}>⚠ TOP SUSPICIOUS ACCOUNTS</div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', gap:8, marginBottom:8, padding:'0 8px' }}>
            {['ACCOUNT','FLAGGED TXS','MAX RISK','TOTAL AMOUNT'].map(h => (
              <div key={h} style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--text2)', letterSpacing:1 }}>{h}</div>
            ))}
          </div>
          {topAccounts.map((a, i) => (
            <div key={i}
              onClick={() => navigate(`/app/investigate?account_id=${a.account}&dataset_id=${datasetId}`)}
              style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 2fr', gap:8,
                padding:'10px 8px', borderTop:'1px solid var(--border)', cursor:'pointer',
                transition:'background 0.2s',
                animation:`slideIn 0.4s ease ${i*0.05}s both` }}
              onMouseEnter={e => e.currentTarget.style.background='var(--bg3)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--accent)' }}>{a.account}</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--yellow)' }}>{a.flagged_outgoing}</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--accent)' }}>{(a.max_risk*100).toFixed(0)}%</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--yellow)' }}>{parseFloat(a.total_amount).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Suspicious Transactions */}
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', marginBottom:16, gap:16 }}>
          <div className="tag">SUSPICIOUS TRANSACTIONS</div>
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--text2)' }}>THRESHOLD:</span>
            <input type="range" min={0.5} max={0.99} step={0.01} value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              style={{ accentColor:'var(--accent)', width:100 }} />
            <span style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', minWidth:30 }}>{threshold.toFixed(2)}</span>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'2fr 2fr 1fr 1fr 1fr 2fr', gap:8, marginBottom:8, padding:'0 8px' }}>
          {['SENDER','RECEIVER','AMOUNT','TYPE','ROUTE','RISK SCORE'].map(h => (
            <div key={h} style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--text2)', letterSpacing:1 }}>{h}</div>
          ))}
        </div>

        {alerts.length === 0
          ? <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text2)', padding:20, textAlign:'center' }}>No alerts at this threshold.</div>
          : alerts.map((a, i) => (
            <div key={i} onClick={() => handleAlertClick(a)}
              style={{ display:'grid', gridTemplateColumns:'2fr 2fr 1fr 1fr 1fr 2fr', gap:8, padding:'10px 8px',
                borderTop:'1px solid var(--border)', cursor:'pointer', transition:'background 0.2s',
                animation:`slideIn 0.4s ease ${i*0.04}s both` }}
              onMouseEnter={e => e.currentTarget.style.background='var(--bg3)'}
              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text)' }}>{a.sender?.slice(0,12)}...</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text)' }}>{a.receiver?.slice(0,12)}...</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--yellow)' }}>{parseFloat(a.amount).toFixed(0)}</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--text2)' }}>{a.type}</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:9 }}>
                <span style={{ color:'var(--green)' }}>{a.from_country||'?'}</span>
                <span style={{ color:'var(--text2)' }}> → </span>
                <span style={{ color:'var(--accent)' }}>{a.to_country||'?'}</span>
              </div>
              <RiskBar score={a.risk_score} animate={barsReady} />
            </div>
          ))}
      </div>
    </div>
  )
}
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getStats, getAlerts } from '../api'

const RiskBar = ({ score }) => (
  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
    <div style={{ flex:1, height:4, background:'var(--bg3)', borderRadius:2, overflow:'hidden' }}>
      <div style={{ width:`${score*100}%`, height:'100%', borderRadius:2, transition:'width 1s ease',
        background:score>0.85?'var(--accent)':score>0.7?'var(--yellow)':'var(--green)' }} />
    </div>
    <span style={{ fontFamily:'var(--mono)', fontSize:10, color:score>0.85?'var(--accent)':'var(--yellow)', minWidth:36 }}>
      {(score*100).toFixed(0)}%
    </span>
  </div>
)

export default function DashboardPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const datasetId = params.get('dataset_id')
  const [stats, setStats] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [threshold, setThreshold] = useState(0.7)

  useEffect(() => {
    if (!datasetId) return
    getStats(datasetId).then(r => setStats(r.data))
    getAlerts(datasetId, threshold).then(r => setAlerts(r.data))
  }, [datasetId, threshold])

  const handleAlertClick = (a) => {
    sessionStorage.setItem('dataset_id', datasetId)
    const params = new URLSearchParams({
      account_id: a.sender,
      dataset_id: datasetId,
      from_country: a.from_country || '',
      to_country: a.to_country || '',
      from_lat: a.from_lat || '40.7',
      from_lon: a.from_lon || '-74.0',
      to_lat: a.to_lat || '51.5',
      to_lon: a.to_lon || '-0.1',
    })
    navigate(`/app/investigate?${params.toString()}`)
  }

  if (!datasetId) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'calc(100vh - 56px)', flexDirection:'column', gap:16 }}>
      <div style={{ fontFamily:'var(--mono)', color:'var(--text2)' }}>No dataset selected.</div>
      <button className="btn" onClick={() => navigate('/app')}>GO TO DATASETS</button>
    </div>
  )

  return (
    <div style={{ padding:32 }}>
      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:24 }}>
        <div className="tag" style={{ color:'var(--accent)' }}>◈ THREAT DASHBOARD</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--text2)', marginLeft:'auto' }}>
          DATASET: <span style={{ color:'var(--green)' }}>{datasetId}</span>
        </div>
      </div>

      {stats && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:16, marginBottom:24 }}>
          {[
            { label:'TOTAL ACCOUNTS', value:stats.total_accounts?.toLocaleString(), color:'var(--text)' },
            { label:'TRANSACTIONS', value:stats.transaction_count?.toLocaleString(), color:'var(--text)' },
            { label:'FLAGGED', value:stats.flagged_count?.toLocaleString(), color:'var(--accent)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card" style={{ textAlign:'center' }}>
              <div className="tag" style={{ marginBottom:8 }}>{label}</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:32, color, animation:'fadeIn 0.5s ease' }}>{value}</div>
            </div>
          ))}
        </div>
      )}

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
                animation:`fadeIn 0.3s ease ${i*0.03}s both` }}
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
              <RiskBar score={a.risk_score} />
            </div>
          ))}
      </div>
    </div>
  )
}
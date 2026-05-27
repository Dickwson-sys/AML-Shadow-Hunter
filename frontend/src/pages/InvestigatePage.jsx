import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import CytoscapeComponent from 'react-cytoscapejs'
import { getNetwork } from '../api'

function AlertGlobe({ fromCountry, toCountry, fromLat, fromLon, toLat, toLon }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const R = Math.min(W, H) * 0.38
    const cx = W / 2, cy = H / 2
    let rot = 0, animId, dotProgress = 0

    const stars = Array.from({ length: 120 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.4 + 0.2, a: Math.random() * 0.55 + 0.08,
      tw: Math.random() * Math.PI * 2, sp: 0.008 + Math.random() * 0.018
    }))

    function toXYZ(latDeg, lonDeg) {
      const lat = latDeg * Math.PI / 180
      const lon = (lonDeg * Math.PI / 180) + rot
      return {
        x: cx + R * Math.cos(lat) * Math.sin(lon),
        y: cy - R * Math.sin(lat),
        z: R * Math.cos(lat) * Math.cos(lon),
        visible: Math.cos(lat) * Math.cos(lon) > -0.15
      }
    }

    function slerp(lat1d, lon1d, lat2d, lon2d, t) {
      const lat1=lat1d*Math.PI/180,lon1=lon1d*Math.PI/180,lat2=lat2d*Math.PI/180,lon2=lon2d*Math.PI/180
      const x1=Math.cos(lat1)*Math.cos(lon1),y1=Math.sin(lat1),z1=Math.cos(lat1)*Math.sin(lon1)
      const x2=Math.cos(lat2)*Math.cos(lon2),y2=Math.sin(lat2),z2=Math.cos(lat2)*Math.sin(lon2)
      const dot=Math.max(-1,Math.min(1,x1*x2+y1*y2+z1*z2)),omega=Math.acos(dot)
      if(Math.abs(omega)<0.001) return {lat:lat1d,lon:lon1d}
      const s=Math.sin(omega),c1=Math.sin((1-t)*omega)/s,c2=Math.sin(t*omega)/s
      const xi=c1*x1+c2*x2,yi=c1*y1+c2*y2,zi=c1*z1+c2*z2
      return {lat:Math.atan2(yi,Math.sqrt(xi*xi+zi*zi))*180/Math.PI,lon:Math.atan2(zi,xi)*180/Math.PI}
    }

    function draw() {
      ctx.clearRect(0,0,W,H)
      stars.forEach(s=>{s.tw+=s.sp;const d=Math.hypot(s.x-cx,s.y-cy);if(d<R+10)return;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle=`rgba(180,200,220,${s.a+Math.sin(s.tw)*0.12})`;ctx.fill()})
      const grad=ctx.createRadialGradient(cx-R*0.3,cy-R*0.3,R*0.05,cx,cy,R)
      grad.addColorStop(0,'rgba(10,22,38,0.97)');grad.addColorStop(1,'rgba(3,7,14,0.99)')
      ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill()
      for(let l=-75;l<=75;l+=15){ctx.beginPath();let f=true;for(let n=0;n<=365;n+=3){const p=toXYZ(l,n);if(!p.visible){f=true;continue};f?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);f=false};ctx.strokeStyle='rgba(93,202,165,0.06)';ctx.lineWidth=0.5;ctx.stroke()}
      for(let n=0;n<360;n+=20){ctx.beginPath();let f=true;for(let l=-90;l<=90;l+=3){const p=toXYZ(l,n);if(!p.visible){f=true;continue};f?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);f=false};ctx.strokeStyle='rgba(93,202,165,0.04)';ctx.lineWidth=0.5;ctx.stroke()}
      ctx.beginPath();let first=true
      for(let i=0;i<=60;i++){const mid=slerp(fromLat,fromLon,toLat,toLon,i/60);const p=toXYZ(mid.lat,mid.lon-rot*180/Math.PI);if(!p.visible){first=true;continue};first?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);first=false}
      ctx.strokeStyle='rgba(255,45,90,0.5)';ctx.lineWidth=1.5;ctx.stroke()
      dotProgress=(dotProgress+0.006)%1
      const dotMid=slerp(fromLat,fromLon,toLat,toLon,dotProgress)
      const dp=toXYZ(dotMid.lat,dotMid.lon-rot*180/Math.PI)
      if(dp.visible){ctx.beginPath();ctx.arc(dp.x,dp.y,4,0,Math.PI*2);ctx.fillStyle='#ff2d5a';ctx.globalAlpha=0.95;ctx.fill();ctx.globalAlpha=1;for(let t=1;t<=6;t++){const tp=(dotProgress-t*0.025+1)%1;const tm=slerp(fromLat,fromLon,toLat,toLon,tp);const trail=toXYZ(tm.lat,tm.lon-rot*180/Math.PI);if(!trail.visible)continue;ctx.beginPath();ctx.arc(trail.x,trail.y,2,0,Math.PI*2);ctx.fillStyle='#ff2d5a';ctx.globalAlpha=0.12*(7-t);ctx.fill();ctx.globalAlpha=1}}
      const fp=toXYZ(fromLat,fromLon)
      if(fp.visible){const pulse=0.5+0.4*Math.sin(Date.now()*0.003);ctx.beginPath();ctx.arc(fp.x,fp.y,8+5*pulse,0,Math.PI*2);ctx.strokeStyle='#5dcaa5';ctx.lineWidth=1;ctx.globalAlpha=0.3*pulse;ctx.stroke();ctx.globalAlpha=1;ctx.beginPath();ctx.arc(fp.x,fp.y,7,0,Math.PI*2);ctx.fillStyle='#5dcaa5';ctx.fill();ctx.font="600 10px 'Share Tech Mono'";ctx.fillStyle='#5dcaa5';ctx.fillText(fromCountry,fp.x+10,fp.y-8)}
      const tp2=toXYZ(toLat,toLon)
      if(tp2.visible){const pulse=0.5+0.4*Math.sin(Date.now()*0.003+Math.PI);ctx.beginPath();ctx.arc(tp2.x,tp2.y,8+5*pulse,0,Math.PI*2);ctx.strokeStyle='#ff2d5a';ctx.lineWidth=1.5;ctx.globalAlpha=0.4*pulse;ctx.stroke();ctx.globalAlpha=1;ctx.beginPath();ctx.arc(tp2.x,tp2.y,7,0,Math.PI*2);ctx.fillStyle='#ff2d5a';ctx.fill();ctx.font="600 10px 'Share Tech Mono'";ctx.fillStyle='#ff2d5a';ctx.fillText(toCountry,tp2.x+10,tp2.y-8)}
      const rim=ctx.createRadialGradient(cx,cy,R-4,cx,cy,R+16);rim.addColorStop(0,'rgba(93,202,165,0.1)');rim.addColorStop(1,'rgba(93,202,165,0)')
      ctx.beginPath();ctx.arc(cx,cy,R+16,0,Math.PI*2);ctx.fillStyle=rim;ctx.fill()
      ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.strokeStyle='rgba(93,202,165,0.18)';ctx.lineWidth=1.5;ctx.stroke()
      rot+=0.002;animId=requestAnimationFrame(draw)
    }
    draw()
    return ()=>cancelAnimationFrame(animId)
  }, [fromLat,fromLon,toLat,toLon])
  return <canvas ref={canvasRef} width={480} height={480} style={{opacity:0.95}} />
}

function IdleGlobe() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas=canvasRef.current;if(!canvas)return
    const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,R=Math.min(W,H)*0.38,cx=W/2,cy=H/2
    let rot=0,animId
    const CITIES=[{lat:40.7,lon:-74.0},{lat:51.5,lon:-0.1},{lat:35.7,lon:139.7},{lat:25.2,lon:55.3},{lat:1.3,lon:103.8},{lat:5.6,lon:-0.2},{lat:6.5,lon:3.4},{lat:47.4,lon:8.5},{lat:22.3,lon:114.2},{lat:-23.5,lon:-46.6},{lat:-1.3,lon:36.8},{lat:55.8,lon:37.6}]
    const CONNS=[[0,1,false],[0,3,true],[1,6,false],[2,7,false],[3,4,true],[5,9,true],[6,10,false],[0,8,false]]
    const arcs=CONNS.map(([a,b,s])=>({a,b,s,prog:Math.random(),spd:0.003+Math.random()*0.004}))
    const stars=Array.from({length:120},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.4+0.2,a:Math.random()*0.55+0.08,tw:Math.random()*Math.PI*2,sp:0.008+Math.random()*0.018}))
    function toXYZ(latD,lonD){const lat=latD*Math.PI/180,lon=(lonD*Math.PI/180)+rot;return{x:cx+R*Math.cos(lat)*Math.sin(lon),y:cy-R*Math.sin(lat),z:R*Math.cos(lat)*Math.cos(lon),visible:Math.cos(lat)*Math.cos(lon)>-0.15}}
    function slerp(p1,p2,t){const lat1=p1.lat*Math.PI/180,lon1=p1.lon*Math.PI/180,lat2=p2.lat*Math.PI/180,lon2=p2.lon*Math.PI/180,x1=Math.cos(lat1)*Math.cos(lon1),y1=Math.sin(lat1),z1=Math.cos(lat1)*Math.sin(lon1),x2=Math.cos(lat2)*Math.cos(lon2),y2=Math.sin(lat2),z2=Math.cos(lat2)*Math.sin(lon2),dot=Math.max(-1,Math.min(1,x1*x2+y1*y2+z1*z2)),omega=Math.acos(dot);if(Math.abs(omega)<0.001)return p1;const s=Math.sin(omega),c1=Math.sin((1-t)*omega)/s,c2=Math.sin(t*omega)/s,xi=c1*x1+c2*x2,yi=c1*y1+c2*y2,zi=c1*z1+c2*z2;return{lat:Math.atan2(yi,Math.sqrt(xi*xi+zi*zi))*180/Math.PI,lon:Math.atan2(zi,xi)*180/Math.PI}}
    function draw(){ctx.clearRect(0,0,W,H);stars.forEach(s=>{s.tw+=s.sp;const d=Math.hypot(s.x-cx,s.y-cy);if(d<R+10)return;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle=`rgba(180,200,220,${s.a+Math.sin(s.tw)*0.12})`;ctx.fill()});const g=ctx.createRadialGradient(cx-R*0.3,cy-R*0.3,R*0.05,cx,cy,R);g.addColorStop(0,'rgba(10,22,38,0.97)');g.addColorStop(1,'rgba(3,7,14,0.99)');ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();for(let l=-75;l<=75;l+=15){ctx.beginPath();let f=true;for(let n=0;n<=365;n+=3){const p=toXYZ(l,n);if(!p.visible){f=true;continue};f?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);f=false};ctx.strokeStyle='rgba(93,202,165,0.06)';ctx.lineWidth=0.5;ctx.stroke()};for(let n=0;n<360;n+=20){ctx.beginPath();let f=true;for(let l=-90;l<=90;l+=3){const p=toXYZ(l,n);if(!p.visible){f=true;continue};f?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);f=false};ctx.strokeStyle='rgba(93,202,165,0.04)';ctx.lineWidth=0.5;ctx.stroke()};arcs.forEach(arc=>{const c1=CITIES[arc.a],c2=CITIES[arc.b];arc.prog=(arc.prog+arc.spd)%1;ctx.beginPath();let f=true;for(let i=0;i<=40;i++){const m=slerp(c1,c2,i/40);const p=toXYZ(m.lat,m.lon-rot*180/Math.PI);if(!p.visible){f=true;continue};f?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);f=false};ctx.strokeStyle=arc.s?'rgba(255,45,90,0.3)':'rgba(93,202,165,0.18)';ctx.lineWidth=arc.s?1.2:0.7;ctx.stroke();const m=slerp(c1,c2,arc.prog);const dp=toXYZ(m.lat,m.lon-rot*180/Math.PI);if(dp.visible){ctx.beginPath();ctx.arc(dp.x,dp.y,arc.s?3:2,0,Math.PI*2);ctx.fillStyle=arc.s?'#ff2d5a':'#5dcaa5';ctx.globalAlpha=0.95;ctx.fill();ctx.globalAlpha=1}});CITIES.forEach(c=>{const p=toXYZ(c.lat,c.lon);if(!p.visible)return;ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fillStyle='#5dcaa5';ctx.globalAlpha=0.7;ctx.fill();ctx.globalAlpha=1});const rim=ctx.createRadialGradient(cx,cy,R-4,cx,cy,R+16);rim.addColorStop(0,'rgba(93,202,165,0.1)');rim.addColorStop(1,'rgba(93,202,165,0)');ctx.beginPath();ctx.arc(cx,cy,R+16,0,Math.PI*2);ctx.fillStyle=rim;ctx.fill();ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.strokeStyle='rgba(93,202,165,0.18)';ctx.lineWidth=1.5;ctx.stroke();rot+=0.0025;animId=requestAnimationFrame(draw)}
    draw();return()=>cancelAnimationFrame(animId)
  },[])
  return <canvas ref={canvasRef} width={480} height={480} style={{opacity:0.95}} />
}

export default function InvestigatePage() {
  const [params, setParams] = useSearchParams()
  const accountId = params.get('account_id')
  const rawDatasetId = params.get('dataset_id')
  const datasetId = (rawDatasetId && rawDatasetId !== 'null') ? rawDatasetId : sessionStorage.getItem('dataset_id')
  const fromCountry = params.get('from_country') || ''
  const toCountry = params.get('to_country') || ''
  const fromLat = parseFloat(params.get('from_lat') || '40.7')
  const fromLon = parseFloat(params.get('from_lon') || '-74.0')
  const toLat = parseFloat(params.get('to_lat') || '51.5')
  const toLon = parseFloat(params.get('to_lon') || '-0.1')

  const [mode, setMode] = useState(accountId ? (fromCountry ? 'globe' : 'graph') : 'idle')
  const [elements, setElements] = useState([])
  const [selected, setSelected] = useState(null)
  const [input, setInput] = useState(accountId || '')
  const [scanning, setScanning] = useState(false)
  const [stats, setStats] = useState({ nodes: 0, edges: 0, flagged: 0 })
  const cyRef = useRef(null)
  const nodeTimersRef = useRef([])

  useEffect(() => {
    if (accountId && datasetId) {
      if (fromCountry) setMode('globe')
      else { setMode('graph'); loadNetwork(accountId) }
    }
  }, [accountId, datasetId])

  const loadNetwork = async (id) => {
    setScanning(true); setSelected(null)
    try {
      const res = await getNetwork(id, datasetId)
      const nodes = res.data.nodes.map(n => ({
        data: { id: n.id, risk: n.risk_score || 0, label: n.id.slice(0, 10) },
        style: { opacity: 0 }  // start invisible for ripple effect
      }))
      const edges = res.data.edges.map((e, i) => ({
        data: { id: `e${i}`, source: e.source, target: e.target, amount: e.amount, risk: e.risk_score || 0 },
        style: { opacity: 0 }
      }))
      setStats({ nodes: nodes.length, edges: edges.length, flagged: nodes.filter(n => n.data.risk > 0.7).length })
      setElements([...nodes, ...edges])
    } catch(e) { console.error(e) }
    finally { setScanning(false) }
  }

  const followMoney = () => {
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
    setMode('graph')
    loadNetwork(accountId || input)
  }

  const trace = () => {
    if (!input.trim()) return
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null }
    setMode('graph'); setElements([])
    setParams({ account_id: input.trim(), dataset_id: datasetId })
    loadNetwork(input.trim())
  }

  // Ripple-in animation: nodes appear one by one from center outward
  const handleCyReady = (cy) => {
    cyRef.current = cy
    cy.on('tap', 'node', (e) => setSelected(e.target.data()))
    cy.on('tap', 'edge', (e) => setSelected(e.target.data()))
    cy.on('tap', (e) => { if (e.target === cy) setSelected(null) })

    // Clear previous timers
    nodeTimersRef.current.forEach(clearTimeout)
    nodeTimersRef.current = []

    // Find center node (the queried account)
    const center = cy.getElementById(accountId || input.trim())
    const sorted = cy.nodes().sort((a, b) => {
      const da = center.length ? center.position() : cy.nodes()[0]?.position() || {x:0,y:0}
      const pa = a.position(), pb = b.position()
      return Math.hypot(pa.x-da.x, pa.y-da.y) - Math.hypot(pb.x-da.x, pb.y-da.y)
    })

    // Fade in nodes with stagger from center outward
    sorted.forEach((node, i) => {
      const t = setTimeout(() => {
        node.animate({ style: { opacity: 1 } }, { duration: 300, easing: 'ease-out' })
      }, i * 120)
      nodeTimersRef.current.push(t)
    })

    // Fade in edges after all nodes
    const edgeDelay = sorted.length * 120
    const et = setTimeout(() => {
      cy.edges().forEach((edge, i) => {
        setTimeout(() => {
          edge.animate({ style: { opacity: 0.8 } }, { duration: 250, easing: 'ease-out' })
        }, i * 60)
      })
    }, edgeDelay)
    nodeTimersRef.current.push(et)
  }

  const stylesheet = [
    { selector: 'node', style: {
      'background-color': (ele) => { const r=ele.data('risk'); return r>0.85?'#e63946':r>0.7?'#ffd60a':'#00ff9d' },
      'border-color': (ele) => { const r=ele.data('risk'); return r>0.85?'#e63946':r>0.7?'#ffd60a':'#1e2a38' },
      'border-width': (ele) => ele.data('risk')>0.7?3:1,
      'width':24,'height':24,'label':'data(label)','color':'#8b949e',
      'font-size':9,'font-family':'Share Tech Mono','text-valign':'bottom','text-margin-y':6
    }},
    { selector: 'node:selected', style: { 'border-color':'#fff','border-width':3,'width':32,'height':32 }},
    { selector: 'edge', style: {
      'width': (ele)=>Math.max(1,Math.min(4,(ele.data('amount')||0)/50000)),
      'line-color': (ele)=>ele.data('risk')>0.7?'#e63946':'#1e2a38',
      'target-arrow-color': (ele)=>ele.data('risk')>0.7?'#e63946':'#2a3a4a',
      'target-arrow-shape':'triangle','curve-style':'bezier','arrow-scale':0.7,'opacity':0.8
    }},
    { selector: 'edge:selected', style: { 'line-color':'#fff','target-arrow-color':'#fff','width':3 }}
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', height: 'calc(100vh - 56px)' }}>
      <div style={{ background:'var(--bg2)', borderRight:'1px solid var(--border)', padding:20, display:'flex', flexDirection:'column', gap:16, overflow:'auto' }}>
        <div className="tag" style={{ color:'var(--accent)' }}>◈ NETWORK PROBE</div>
        <div>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&trace()}
            placeholder="Enter account ID..."
            style={{ width:'100%', background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text)', fontFamily:'var(--mono)', fontSize:11, padding:'8px 10px', marginBottom:8 }} />
          <button className="btn btn-green" style={{ width:'100%' }} onClick={trace}>
            {scanning ? 'SCANNING...' : 'TRACE NETWORK'}
          </button>
        </div>

        {mode==='globe' && fromCountry && (
          <div className="card">
            <div className="tag" style={{ marginBottom:12 }}>SUSPICIOUS TRANSFER</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--text2)', lineHeight:2.2 }}>
              <div>FROM: <span style={{ color:'var(--green)' }}>{fromCountry}</span></div>
              <div>TO: <span style={{ color:'var(--accent)' }}>{toCountry}</span></div>
              <div>ACCOUNT: <span style={{ color:'var(--text)', fontSize:9 }}>{accountId?.slice(0,14)}</span></div>
            </div>
            <button className="btn" style={{ width:'100%', marginTop:12, borderColor:'var(--accent)', color:'var(--accent)', fontSize:10 }}
              onClick={followMoney}>◈ FOLLOW THE MONEY</button>
          </div>
        )}

        {mode==='graph' && elements.length>0 && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            {[['NODES',stats.nodes,'var(--green)'],['EDGES',stats.edges,'var(--green)'],['FLAGGED',stats.flagged,'var(--accent)']].map(([l,v,c])=>(
              <div key={l} className="card" style={{ padding:10, textAlign:'center', gridColumn:l==='FLAGGED'?'span 2':'auto' }}>
                <div style={{ fontFamily:'var(--mono)', fontSize:8, color:'var(--text2)', letterSpacing:1, marginBottom:4 }}>{l}</div>
                <div style={{ fontFamily:'var(--mono)', fontSize:20, color:c }}>{v}</div>
              </div>
            ))}
          </div>
        )}

        {selected && mode==='graph' && (
          <div className="card" style={{ animation:'fadeIn 0.2s ease' }}>
            <div className="tag" style={{ marginBottom:12 }}>{selected.source?'TRANSACTION':'ACCOUNT'} DETAILS</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--text2)', lineHeight:2.2 }}>
              {selected.source ? (
                <>
                  <div>FROM: <span style={{ color:'var(--text)' }}>{selected.source?.slice(0,12)}</span></div>
                  <div>TO: <span style={{ color:'var(--text)' }}>{selected.target?.slice(0,12)}</span></div>
                  <div>AMOUNT: <span style={{ color:'var(--yellow)' }}>{parseFloat(selected.amount||0).toLocaleString()}</span></div>
                  <div>RISK: <span style={{ color:selected.risk>0.7?'var(--accent)':'var(--green)' }}>{(selected.risk*100).toFixed(1)}%</span></div>
                </>
              ) : (
                <>
                  <div>ID: <span style={{ color:'var(--text)', fontSize:9 }}>{selected.id}</span></div>
                  <div>RISK: <span style={{ color:selected.risk>0.85?'var(--accent)':selected.risk>0.7?'var(--yellow)':'var(--green)' }}>{(selected.risk*100).toFixed(1)}%</span></div>
                  <div>STATUS: <span style={{ color:selected.risk>0.7?'var(--accent)':'var(--green)' }}>{selected.risk>0.85?'⚠ HIGH RISK':selected.risk>0.7?'⚡ MEDIUM RISK':'✓ CLEAN'}</span></div>
                </>
              )}
            </div>
            {!selected.source && (
              <button className="btn btn-green" style={{ width:'100%', marginTop:12, fontSize:10 }}
                onClick={()=>{ setInput(selected.id); if(cyRef.current){cyRef.current.destroy();cyRef.current=null} loadNetwork(selected.id) }}>
                ◈ FOLLOW THE MONEY
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop:'auto' }}>
          <div className="tag" style={{ marginBottom:8 }}>LEGEND</div>
          {[['HIGH RISK (>85%)','var(--accent)'],['MEDIUM RISK (>70%)','var(--yellow)'],['LOW RISK','var(--green)']].map(([l,c])=>(
            <div key={l} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:c }} />
              <span style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--text2)', letterSpacing:1 }}>{l}</span>
            </div>
          ))}
          {mode==='globe' && (
            <div style={{ marginTop:12, fontFamily:'var(--mono)', fontSize:9, color:'var(--text2)', lineHeight:1.8 }}>
              <div style={{ color:'var(--green)' }}>● Green = origin country</div>
              <div style={{ color:'var(--accent)' }}>● Red = destination country</div>
              <div style={{ color:'var(--accent)' }}>— Red arc = flagged flow</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ background:'var(--bg)', position:'relative', overflow:'hidden' }}>
        {scanning && (
          <div style={{ position:'absolute', inset:0, zIndex:10, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, background:'rgba(8,10,15,0.85)' }}>
            <div style={{ fontFamily:'var(--mono)', color:'var(--green)', fontSize:13, letterSpacing:3, animation:'pulse 1s infinite' }}>SCANNING NETWORK...</div>
            <div style={{ fontFamily:'var(--mono)', color:'var(--text2)', fontSize:10 }}>Tracing transaction paths from {(accountId||input)?.slice(0,12)}</div>
          </div>
        )}

        {!scanning && mode==='idle' && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:20 }}>
            <IdleGlobe />
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--text2)', letterSpacing:3 }}>ENTER AN ACCOUNT ID TO TRACE ITS NETWORK</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'rgba(255,45,90,0.5)', letterSpacing:2 }}>● RED PATHS = FLAGGED TRANSACTIONS</div>
          </div>
        )}

        {!scanning && mode==='globe' && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:20 }}>
            <AlertGlobe fromCountry={fromCountry} toCountry={toCountry} fromLat={fromLat} fromLon={fromLon} toLat={toLat} toLon={toLon} />
            <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--accent)', letterSpacing:2, animation:'pulse 1s infinite' }}>
              ⚠ SUSPICIOUS TRANSFER DETECTED — CLICK FOLLOW THE MONEY TO INVESTIGATE
            </div>
          </div>
        )}

        {!scanning && mode==='graph' && elements.length>0 && (
          <CytoscapeComponent elements={elements} stylesheet={stylesheet}
            layout={{ name:'cose', animate:true, animationDuration:800, nodeRepulsion:10000, idealEdgeLength:120, gravity:0.5 }}
            style={{ width:'100%', height:'100%' }}
            cy={handleCyReady} />
        )}

        <div style={{ position:'absolute', bottom:16, right:16, fontFamily:'var(--mono)', fontSize:9, color:'var(--border)', letterSpacing:2 }}>
          SHADOW HUNTER — AML INTELLIGENCE SYSTEM
        </div>
      </div>
    </div>
  )
}
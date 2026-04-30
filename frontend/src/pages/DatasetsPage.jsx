import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDatasets, deleteDataset, previewColumns, uploadDataset } from '../api'

export default function DatasetsPage() {
    const [datasets, setDatasets] = useState([])
    const [file, setFile] = useState(null)
    const [columns, setColumns] = useState([])
    const [mapping, setMapping] = useState({ sender: '', receiver: '', amount: '', step: '', type_col: '' })
    const [name, setName] = useState('')
    const [uploading, setUploading] = useState(false)
    const [log, setLog] = useState([])
    const [step, setStep] = useState('idle') // idle | mapping | uploading | done
    const navigate = useNavigate()

    useEffect(() => { fetchDatasets() }, [])

    const fetchDatasets = async () => {
        const res = await getDatasets()
        setDatasets(res.data)
    }

    const addLog = (msg) => setLog(p => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...p].slice(0, 20))

    const handleFile = async (e) => {
        const f = e.target.files[0]
        if (!f) return
        setFile(f)
        setName(f.name.replace('.csv', ''))
        addLog(`Reading file: ${f.name}`)
        const res = await previewColumns(f)
        setColumns(res.data.columns)
        setMapping({ sender: '', receiver: '', amount: '', step: '', type_col: '' })
        setStep('mapping')
        addLog(`Detected ${res.data.columns.length} columns. Please map them.`)
    }

    const handleUpload = async () => {
        for (const k of ['sender', 'receiver', 'amount', 'step']) {
            if (!mapping[k]) return alert(`Please map the "${k}" column`)
        }
        setStep('uploading')
        setUploading(true)
        addLog('Initializing graph pipeline...')
        addLog('Connecting to Neo4j...')
        addLog('Loading GNN model...')
        try {
            addLog('Ingesting transactions and scoring with GNN...')
            const res = await uploadDataset(file, mapping, name)
            addLog(`✓ Ingested ${res.data.transactions} transactions`)
            addLog(`✓ Flagged ${res.data.flagged} suspicious transactions`)
            addLog(`✓ Dataset ID: ${res.data.dataset_id}`)
            setStep('done')
            fetchDatasets()
        } catch (e) {
            addLog(`✗ Error: ${e.response?.data?.detail || e.message}`)
            setStep('mapping')
        }
        setUploading(false)
    }

    const handleDelete = async (id) => {
        await deleteDataset(id)
        fetchDatasets()
    }

    const REQUIRED = ['sender', 'receiver', 'amount', 'step']
    const LABELS = { sender: 'Sender Account', receiver: 'Receiver Account', amount: 'Amount', step: 'Timestamp/Step', type_col: 'Transaction Type (optional)' }

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: 32, minHeight: 'calc(100vh - 56px)' }}>

            {/* LEFT — Upload */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="tag" style={{ color: 'var(--accent)', marginBottom: 4 }}>◈ DATA INGESTION TERMINAL</div>

                {/* File Drop */}
                <div className="card" style={{ border: file ? '1px solid var(--green)' : '1px dashed var(--border)', textAlign: 'center', padding: 40, cursor: 'pointer', position: 'relative' }}
                    onClick={() => document.getElementById('fileInput').click()}>
                    <input id="fileInput" type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 28, color: file ? 'var(--green)' : 'var(--border)', marginBottom: 8 }}>⬆</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: file ? 'var(--green)' : 'var(--text2)' }}>
                        {file ? `✓ ${file.name}` : 'DROP CSV FILE OR CLICK TO BROWSE'}
                    </div>
                </div>

                {/* Column Mapping */}
                {step !== 'idle' && (
                    <div className="card" style={{ animation: 'fadeIn 0.3s ease' }}>
                        <div className="tag" style={{ marginBottom: 16 }}>COLUMN MAPPING</div>
                        <input value={name} onChange={e => setName(e.target.value)}
                            placeholder="Dataset name..."
                            style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, padding: '8px 12px', marginBottom: 12 }} />
                        {Object.keys(mapping).map(key => (
                            <div key={key} style={{ marginBottom: 10 }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: REQUIRED.includes(key) ? 'var(--accent)' : 'var(--text2)', marginBottom: 4, letterSpacing: 1 }}>
                                    {LABELS[key]} {REQUIRED.includes(key) && '*'}
                                </div>
                                <select value={mapping[key]} onChange={e => setMapping(p => ({ ...p, [key]: e.target.value }))}
                                    style={{ width: '100%', background: 'var(--bg3)', border: `1px solid ${mapping[key] ? 'var(--green)' : 'var(--border)'}`, color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 11, padding: '6px 10px' }}>
                                    <option value="">-- select column --</option>
                                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        ))}
                        <button className="btn btn-green" style={{ width: '100%', marginTop: 8 }}
                            onClick={handleUpload} disabled={uploading}>
                            {uploading ? 'ANALYZING...' : 'INGEST & SCORE DATASET'}
                        </button>
                    </div>
                )}
            </div>

            {/* RIGHT — Log + Datasets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Terminal Log */}
                <div className="card" style={{ fontFamily: 'var(--mono)', fontSize: 11, minHeight: 160, background: '#050709' }}>
                    <div className="tag" style={{ marginBottom: 12 }}>SYSTEM LOG</div>
                    {log.length === 0
                        ? <div style={{ color: 'var(--text2)' }}>{'>'} Awaiting input...</div>
                        : log.map((l, i) => (
                            <div key={i} style={{ color: l.includes('✓') ? 'var(--green)' : l.includes('✗') ? 'var(--accent)' : 'var(--text2)', marginBottom: 4 }}>
                                {'>'} {l}
                            </div>
                        ))}
                    {uploading && <div style={{ color: 'var(--yellow)', animation: 'pulse 1s infinite' }}>{'>'} Processing...</div>}
                </div>

                {/* Dataset List */}
                <div className="card" style={{ flex: 1 }}>
                    <div className="tag" style={{ marginBottom: 16 }}>LOADED DATASETS — {datasets.length}</div>
                    {datasets.length === 0
                        ? <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>No datasets loaded.</div>
                        : datasets.map(d => (
                            <div key={d.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontFamily: 'var(--sans)', fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{d.name}</div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>
                                        ID: {d.id} &nbsp;|&nbsp; {d.transaction_count?.toLocaleString()} txns &nbsp;|&nbsp;
                                        <span style={{ color: 'var(--accent)' }}>{d.flagged_count} flagged</span>
                                    </div>
                                </div>
                                <button className="btn btn-green" style={{ fontSize: 10, padding: '5px 12px' }}
                                    onClick={() => {
                                        sessionStorage.setItem('dataset_id', d.id)
                                        navigate(`/app/dashboard?dataset_id=${d.id}`)
                                    }}>ANALYZE</button>
                                <button className="btn" style={{ fontSize: 10, padding: '5px 12px' }}
                                    onClick={() => handleDelete(d.id)}>DEL</button>
                            </div>
                        ))}
                </div>
            </div>
        </div>
    )
}
import os, sys, io, uuid, random
from datetime import datetime
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from contextlib import asynccontextmanager
from pydantic import BaseModel
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "ml"))
from model_handler import AMLInference

URI, AUTH = "bolt://localhost:7687", ("neo4j", "password123")
driver = GraphDatabase.driver(URI, auth=AUTH)
model = AMLInference()
CURRENCIES = [
    'Australian Dollar', 'Bitcoin', 'Brazil Real', 'Canadian Dollar',
    'Euro', 'Mexican Peso', 'Ruble', 'Rupee', 'Saudi Riyal', 'Shekel',
    'Swiss Franc', 'UK Pound', 'US Dollar', 'Yen', 'Yuan'
]
FORMATS = ['ACH', 'Bitcoin', 'Cash', 'Cheque', 'Credit Card', 'Reinvestment', 'Wire']
BATCH_SIZE = 500

@asynccontextmanager
async def lifespan(app: FastAPI):
    with driver.session() as s:
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (d:Dataset) REQUIRE d.id IS UNIQUE")
    yield
    driver.close()

app = FastAPI(title="AML Shadow Hunter", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Column mapping schema ──────────────────────────────────────────────
class ColumnMap(BaseModel):
    sender: str
    receiver: str
    amount: str
    step: str
    type_col: Optional[str] = None  # optional

# ── Helpers ────────────────────────────────────────────────────────────
def get_degrees(session, account_id, dataset_id):
    r = session.run("""
        MATCH (a:Account {id: $id, dataset_id: $did})
        RETURN size((a)-[:TRANSFERRED]->()) AS out_deg,
               size(()-[:TRANSFERRED]->(a)) AS in_deg
    """, id=account_id, did=dataset_id).single()
    return [r["in_deg"], r["out_deg"]] if r else [0, 0]

def flush(session, batch, dataset_id):
    session.run("""
        UNWIND $batch AS tx
        MERGE (s:Account {id: tx.sender, dataset_id: $did})
        MERGE (r:Account {id: tx.receiver, dataset_id: $did})
        CREATE (s)-[:TRANSFERRED {
            amount: tx.amount, hour: tx.hour, format: tx.format,
            currency: tx.currency, pay_curr: tx.pay_curr,
            rec_curr: tx.rec_curr, is_fraud: tx.is_fraud,
            risk_score: tx.risk_score, dataset_id: $did
        }]->(r)
    """, batch=batch, did=dataset_id)

# ── Routes ─────────────────────────────────────────────────────────────
@app.get("/datasets")
def list_datasets():
    with driver.session() as s:
        result = s.run("MATCH (d:Dataset) RETURN d ORDER BY d.uploaded_at DESC")
        return [dict(r["d"]) for r in result]

@app.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str):
    with driver.session() as s:
        s.run("MATCH (n) WHERE n.dataset_id = $did DETACH DELETE n", did=dataset_id)
        s.run("MATCH (d:Dataset {id: $did}) DELETE d", did=dataset_id)
    return {"message": "Dataset deleted"}

@app.post("/upload/preview")
async def preview_columns(file: UploadFile = File(...)):
    contents = await file.read()
    df = pd.read_csv(io.BytesIO(contents), nrows=5)
    return {"columns": list(df.columns), "sample": df.to_dict(orient="records")}

@app.post("/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    sender: str = "nameOrig",
    receiver: str = "nameDest",
    amount: str = "amount",
    step: str = "step",
    type_col: str = "",
    dataset_name: str = ""
):
    contents = await file.read()
    df = pd.read_csv(io.BytesIO(contents))

    # validate required columns
    for col in [sender, receiver, amount, step]:
        if col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{col}' not found in CSV")

    df = df.dropna(subset=[sender, receiver, amount, step])
    dataset_id = str(uuid.uuid4())[:8]
    name = dataset_name or file.filename

    with driver.session() as session:
        session.run("""
            CREATE (d:Dataset {id: $id, name: $name, uploaded_at: $ts,
                               transaction_count: 0, flagged_count: 0})
        """, id=dataset_id, name=name, ts=datetime.utcnow().isoformat())

        batch, total, flagged = [], 0, 0
        for _, row in df.iterrows():
            pay_curr = random.choice(CURRENCIES)
            rec_curr = random.choice(CURRENCIES)
            tx_type = str(row[type_col]) if type_col and type_col in df.columns else 'Wire'
            sender_stats = get_degrees(session, str(row[sender]), dataset_id)
            receiver_stats = get_degrees(session, str(row[receiver]), dataset_id)
            tx_details = {
                "amount": float(row[amount]),
                "hour": int(float(row[step])) % 24,
                "format": tx_type,
                "currency": pay_curr,
                "pay_curr": pay_curr,
                "rec_curr": rec_curr
            }
            risk_score = model.predict(sender_stats, receiver_stats, tx_details)
            if risk_score >= 0.7:
                flagged += 1
            batch.append({
                "sender": str(row[sender]),
                "receiver": str(row[receiver]),
                **tx_details,
                "is_fraud": bool(row.get("isFraud", False)),
                "risk_score": risk_score
            })
            total += 1
            if len(batch) == BATCH_SIZE:
                flush(session, batch, dataset_id)
                batch = []
        if batch:
            flush(session, batch, dataset_id)

        session.run("""
            MATCH (d:Dataset {id: $id})
            SET d.transaction_count = $total, d.flagged_count = $flagged
        """, id=dataset_id, total=total, flagged=flagged)

    return {"dataset_id": dataset_id, "transactions": total, "flagged": flagged}

@app.get("/alerts/suspicious")
def get_alerts(dataset_id: str, threshold: float = 0.7, limit: int = 100):
    with driver.session() as s:
        result = s.run("""
            MATCH (src)-[r:TRANSFERRED]->(tgt)
            WHERE r.dataset_id = $did AND r.risk_score >= $threshold
            RETURN src.id AS sender, tgt.id AS receiver,
                   r.amount AS amount, r.risk_score AS risk_score,
                   r.format AS type, r.currency AS currency
            ORDER BY r.risk_score DESC LIMIT $limit
        """, did=dataset_id, threshold=threshold, limit=limit)
        return [r.data() for r in result]

@app.get("/account/{account_id}/network")
def get_network(account_id: str, dataset_id: str):
    with driver.session() as s:
        result = s.run("""
            MATCH (a:Account {id: $id, dataset_id: $did})-[r:TRANSFERRED*1..2]-(b)
            RETURN a, r, b LIMIT 100
        """, id=account_id, did=dataset_id)
        nodes, edges = {}, []
        for record in result:
            for node in [record["a"], record["b"]]:
                nid = node["id"]
                nodes[nid] = {"id": nid, "risk_score": node.get("risk_score", 0)}
            for rel in record["r"]:
                edges.append({
                    "source": rel.start_node["id"],
                    "target": rel.end_node["id"],
                    "amount": rel.get("amount"),
                    "risk_score": rel.get("risk_score", 0)
                })
        return {"nodes": list(nodes.values()), "edges": edges}

@app.get("/stats")
def get_stats(dataset_id: str):
    with driver.session() as s:
        d = s.run("MATCH (d:Dataset {id: $did}) RETURN d", did=dataset_id).single()
        if not d:
            raise HTTPException(status_code=404, detail="Dataset not found")
        return dict(d["d"])
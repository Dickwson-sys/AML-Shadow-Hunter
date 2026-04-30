import os, sys, io, uuid, warnings
from datetime import datetime
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from contextlib import asynccontextmanager

warnings.filterwarnings('ignore')

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "ml"))
from model_handler import AMLInference

URI, AUTH = "bolt://localhost:7687", ("neo4j", "password123")
driver = GraphDatabase.driver(URI, auth=AUTH)
model = AMLInference()

BATCH_SIZE = 2000

COUNTRY_COORDS = {
    'Portugal': (38.7, -9.1), 'Canada': (56.1, -106.3), 'UK': (51.5, -0.1),
    'Germany': (52.5, 13.4), 'National': (40.7, -74.0), 'Spain': (40.4, -3.7),
    'Savings': (48.8, 2.3), 'Brazil': (-23.5, -46.6), 'Mexico': (23.6, -102.5),
    'Russia': (55.8, 37.6), 'Acme': (40.7, -74.0), 'Croatia': (45.8, 15.9),
    'Japan': (35.7, 139.7), 'Italy': (41.9, 12.5), 'Israel': (31.8, 35.2),
    'Willows': (37.5, -122.0), 'Bank': (40.7, -74.0), 'United': (40.7, -74.0),
    'Swiss': (47.4, 8.5), 'China': (39.9, 116.4), 'India': (28.6, 77.2),
    'Australia': (-33.9, 151.2), 'Singapore': (1.3, 103.8), 'UAE': (25.2, 55.3),
    'Ghana': (5.6, -0.2), 'Nigeria': (6.5, 3.4), 'Kenya': (-1.3, 36.8),
    'South': (-26.2, 28.0), 'Cayman': (19.3, -81.4), 'Hong': (22.3, 114.2),
}

def get_country_info(bank_name: str):
    if not bank_name or pd.isna(bank_name):
        return 'United States', 40.7, -74.0
    first_word = str(bank_name).split()[0]
    if first_word in COUNTRY_COORDS:
        lat, lon = COUNTRY_COORDS[first_word]
        country = first_word if first_word not in ['National', 'Savings', 'Acme', 'Willows', 'Bank', 'United'] else 'United States'
        return country, lat, lon
    return 'United States', 40.7, -74.0

def load_account_map():
    account_map = {}
    accounts_path = os.path.join(os.path.dirname(__file__), 'data', 'HI-Small_accounts.csv')
    if os.path.exists(accounts_path):
        try:
            acc_df = pd.read_csv(accounts_path)
            acc_df.columns = [c.strip() for c in acc_df.columns]
            bank_col = 'Bank Name' if 'Bank Name' in acc_df.columns else acc_df.columns[0]
            acct_col = 'Account Number' if 'Account Number' in acc_df.columns else acc_df.columns[2]
            for _, row in acc_df.iterrows():
                country, lat, lon = get_country_info(row[bank_col])
                account_map[str(row[acct_col]).strip()] = (country, lat, lon)
        except Exception as e:
            print(f"Warning: could not load accounts file: {e}")
    return account_map

ACCOUNT_MAP = load_account_map()
print(f"Loaded {len(ACCOUNT_MAP)} account-country mappings")

@asynccontextmanager
async def lifespan(app: FastAPI):
    with driver.session() as s:
        s.run("CREATE CONSTRAINT IF NOT EXISTS FOR (d:Dataset) REQUIRE d.id IS UNIQUE")
        s.run("DROP CONSTRAINT account_id_unique IF EXISTS")
    yield
    driver.close()

app = FastAPI(title="AML Shadow Hunter", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def flush(session, batch, dataset_id):
    session.run("""
        UNWIND $batch AS tx
        MERGE (s:Account {id: tx.sender, dataset_id: $did})
        MERGE (r:Account {id: tx.receiver, dataset_id: $did})
        CREATE (s)-[:TRANSFERRED {
            amount: tx.amount, hour: tx.hour, format: tx.format,
            currency: tx.currency, pay_curr: tx.pay_curr,
            rec_curr: tx.rec_curr, is_fraud: tx.is_fraud,
            risk_score: tx.risk_score, dataset_id: $did,
            from_country: tx.from_country, to_country: tx.to_country,
            from_lat: tx.from_lat, from_lon: tx.from_lon,
            to_lat: tx.to_lat, to_lon: tx.to_lon
        }]->(r)
    """, batch=batch, did=dataset_id)

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
    df = pd.read_csv(io.BytesIO(contents), nrows=150000)

    for col in [sender, receiver, amount, step]:
        if col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Column '{col}' not found in CSV")

    df = df.dropna(subset=[sender, receiver, amount, step])
    dataset_id = str(uuid.uuid4())[:8]
    name = dataset_name or file.filename

    # Step 1: Vectorized preprocessing
    df['hour'] = pd.to_datetime(df[step], errors='coerce').dt.hour.fillna(0).astype(int)
    df['amount'] = df[amount].astype(float)
    df['format'] = df[type_col].fillna('Wire') if type_col and type_col in df.columns else 'Wire'
    df['currency'] = df['Payment Currency'].fillna('US Dollar') if 'Payment Currency' in df.columns else 'US Dollar'
    df['pay_curr'] = df['currency']
    df['rec_curr'] = df['Receiving Currency'].fillna('US Dollar') if 'Receiving Currency' in df.columns else 'US Dollar'

    # Step 2: Batch scoring — all transactions in one vectorized pass
    print(f"Batch scoring {len(df)} transactions...")
    scores = model.predict_batch(df)
    df['risk_score'] = scores
    print(f"Scoring complete.")

    # Step 3: Geo mapping
    def get_geo(uid):
        return ACCOUNT_MAP.get(str(uid), ('United States', 40.7, -74.0))

    geo_s = df[sender].apply(get_geo)
    geo_r = df[receiver].apply(get_geo)
    df['from_country'] = [g[0] for g in geo_s]
    df['from_lat'] = [g[1] for g in geo_s]
    df['from_lon'] = [g[2] for g in geo_s]
    df['to_country'] = [g[0] for g in geo_r]
    df['to_lat'] = [g[1] for g in geo_r]
    df['to_lon'] = [g[2] for g in geo_r]

    # Step 4: Create dataset node
    with driver.session() as session:
        session.run("""
            CREATE (d:Dataset {id: $id, name: $name, uploaded_at: $ts,
                               transaction_count: 0, flagged_count: 0})
        """, id=dataset_id, name=name, ts=datetime.utcnow().isoformat())

    # Step 5: Write to Neo4j in fresh batch sessions
    print(f"Writing to Neo4j...")
    for i in range(0, len(df), BATCH_SIZE):
        chunk = df.iloc[i:i + BATCH_SIZE]
        batch_data = []
        for _, row in chunk.iterrows():
            batch_data.append({
                "sender": str(row[sender]), "receiver": str(row[receiver]),
                "amount": row['amount'], "hour": int(row['hour']),
                "format": str(row['format']),
                "currency": str(row['currency']),
                "pay_curr": str(row['pay_curr']),
                "rec_curr": str(row['rec_curr']),
                "is_fraud": bool(row.get('Is Laundering', row.get('isFraud', False))),
                "risk_score": float(row['risk_score']),
                "from_country": row['from_country'], "to_country": row['to_country'],
                "from_lat": float(row['from_lat']), "from_lon": float(row['from_lon']),
                "to_lat": float(row['to_lat']), "to_lon": float(row['to_lon']),
            })
        with driver.session() as session:
            flush(session, batch_data, dataset_id)

    flagged = int((df['risk_score'] >= 0.7).sum())
    with driver.session() as session:
        session.run("""
            MATCH (d:Dataset {id: $id})
            SET d.transaction_count = $total, d.flagged_count = $flagged
        """, id=dataset_id, total=len(df), flagged=flagged)

    return {"dataset_id": dataset_id, "transactions": len(df), "flagged": flagged}

@app.get("/alerts/suspicious")
def get_alerts(dataset_id: str, threshold: float = 0.7, limit: int = 100):
    with driver.session() as s:
        result = s.run("""
            MATCH (src)-[r:TRANSFERRED]->(tgt)
            WHERE r.dataset_id = $did AND r.risk_score >= $threshold
            RETURN src.id AS sender, tgt.id AS receiver,
                   r.amount AS amount, r.risk_score AS risk_score,
                   r.format AS type, r.currency AS currency,
                   r.from_country AS from_country, r.to_country AS to_country,
                   r.from_lat AS from_lat, r.from_lon AS from_lon,
                   r.to_lat AS to_lat, r.to_lon AS to_lon
            ORDER BY r.risk_score DESC LIMIT $limit
        """, did=dataset_id, threshold=threshold, limit=limit)
        return [r.data() for r in result]

@app.get("/account/{account_id}/network")
def get_network(account_id: str, dataset_id: str):
    with driver.session() as s:
        result = s.run("""
            MATCH (a:Account {id: $id, dataset_id: $did})-[r:TRANSFERRED]-(b)
            RETURN a, r, b LIMIT 100
        """, id=account_id, did=dataset_id)
        nodes, edges = {}, []
        for record in result:
            for node in [record["a"], record["b"]]:
                nid = node["id"]
                nodes[nid] = {"id": nid, "risk_score": node.get("risk_score", 0)}
            rel = record["r"]
            edges.append({
                "source": rel.start_node["id"],
                "target": rel.end_node["id"],
                "amount": rel.get("amount"),
                "risk_score": rel.get("risk_score", 0),
                "from_country": rel.get("from_country", ""),
                "to_country": rel.get("to_country", "")
            })
        return {"nodes": list(nodes.values()), "edges": edges}

@app.get("/stats")
def get_stats(dataset_id: str):
    with driver.session() as s:
        d = s.run("MATCH (d:Dataset {id: $did}) RETURN d", did=dataset_id).single()
        if not d:
            raise HTTPException(status_code=404, detail="Dataset not found")
        accounts = s.run(
            "MATCH (a:Account {dataset_id: $did}) RETURN count(a) AS c", did=dataset_id
        ).single()["c"]
        data = dict(d["d"])
        data["total_accounts"] = accounts
        return data
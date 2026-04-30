import os, sys, warnings
from datetime import datetime
import pandas as pd
from neo4j import GraphDatabase

warnings.filterwarnings('ignore')

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "ml"))
from model_handler import AMLInference

URI, AUTH = "bolt://localhost:7687", ("neo4j", "password123")
BATCH_SIZE = 500

COUNTRY_COORDS = {
    'Portugal': (38.7, -9.1), 'Canada': (56.1, -106.3), 'UK': (51.5, -0.1),
    'Germany': (52.5, 13.4), 'Spain': (40.4, -3.7), 'Brazil': (-23.5, -46.6),
    'Mexico': (23.6, -102.5), 'Russia': (55.8, 37.6), 'Croatia': (45.8, 15.9),
    'Japan': (35.7, 139.7), 'Italy': (41.9, 12.5), 'Israel': (31.8, 35.2),
    'Swiss': (47.4, 8.5), 'China': (39.9, 116.4), 'India': (28.6, 77.2),
    'Australia': (-33.9, 151.2), 'Singapore': (1.3, 103.8),
    'Ghana': (5.6, -0.2), 'Nigeria': (6.5, 3.4), 'Kenya': (-1.3, 36.8),
    'Cayman': (19.3, -81.4), 'Hong': (22.3, 114.2),
}

def get_country_info(bank_name):
    if not bank_name or pd.isna(bank_name):
        return 'United States', 40.7, -74.0
    first_word = str(bank_name).split()[0]
    if first_word in COUNTRY_COORDS:
        return first_word, *COUNTRY_COORDS[first_word]
    return 'United States', 40.7, -74.0

def load_account_map():
    path = os.path.join(os.path.dirname(__file__), 'data', 'HI-Small_accounts.csv')
    if not os.path.exists(path):
        return {}
    acc_df = pd.read_csv(path)
    acc_df.columns = [c.strip() for c in acc_df.columns]
    bank_col = 'Bank Name' if 'Bank Name' in acc_df.columns else acc_df.columns[0]
    acct_col = 'Account Number' if 'Account Number' in acc_df.columns else acc_df.columns[2]
    result = {}
    for _, row in acc_df.iterrows():
        country, lat, lon = get_country_info(row[bank_col])
        result[str(row[acct_col]).strip()] = (country, lat, lon)
    return result

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

def ingest(csv_path=None, nrows=150000, dataset_id="demo2025"):
    if csv_path is None:
        csv_path = os.path.join(os.path.dirname(__file__), 'data', 'HI-Small_Trans.csv')

    print(f"Loading {nrows} rows from {csv_path}...")
    df = pd.read_csv(csv_path, nrows=nrows)
    df = df.dropna(subset=['Account', 'Account.1', 'Amount Paid', 'Timestamp'])

    print("Preprocessing...")
    df['hour'] = pd.to_datetime(df['Timestamp'], errors='coerce').dt.hour.fillna(0).astype(int)
    df['amount'] = df['Amount Paid'].astype(float)
    df['format'] = df['Payment Format'].fillna('Wire')
    df['currency'] = df['Payment Currency'].fillna('US Dollar') if 'Payment Currency' in df.columns else 'US Dollar'
    df['pay_curr'] = df['currency']
    df['rec_curr'] = df['Receiving Currency'].fillna('US Dollar') if 'Receiving Currency' in df.columns else 'US Dollar'

    print("Loading account-country map...")
    account_map = load_account_map()
    print(f"Loaded {len(account_map)} mappings")

    print(f"Batch scoring {len(df)} transactions...")
    model = AMLInference()
    scores = model.predict_batch(df)
    df['risk_score'] = scores
    flagged = int((df['risk_score'] >= 0.7).sum())
    print(f"Scoring done. {flagged} flagged.")

    def get_geo(uid):
        return account_map.get(str(uid), ('United States', 40.7, -74.0))

    geo_s = df['Account'].apply(get_geo)
    geo_r = df['Account.1'].apply(get_geo)
    df['from_country'] = [g[0] for g in geo_s]
    df['from_lat'] = [g[1] for g in geo_s]
    df['from_lon'] = [g[2] for g in geo_s]
    df['to_country'] = [g[0] for g in geo_r]
    df['to_lat'] = [g[1] for g in geo_r]
    df['to_lon'] = [g[2] for g in geo_r]

    driver = GraphDatabase.driver(URI, auth=AUTH)

    with driver.session() as s:
        s.run("MATCH (n) WHERE n.dataset_id = $did DETACH DELETE n", did=dataset_id)
        s.run("MATCH (d:Dataset {id: $did}) DELETE d", did=dataset_id)
        s.run("""CREATE (d:Dataset {id: $id, name: $name, uploaded_at: $ts,
                    transaction_count: 0, flagged_count: 0})""",
              id=dataset_id, name=os.path.basename(csv_path),
              ts=datetime.utcnow().isoformat())

    print(f"Writing {len(df)} rows to Neo4j...")
    
    # Create index for fast MERGE
    d = GraphDatabase.driver(URI, auth=AUTH)
    with d.session() as s:
        s.run("CREATE INDEX account_idx IF NOT EXISTS FOR (a:Account) ON (a.id, a.dataset_id)")
    d.close()
    import time
    time.sleep(3)  # wait for index to build
    print("Index created.")
    for i in range(0, len(df), BATCH_SIZE):
        chunk = df.iloc[i:i + BATCH_SIZE]
        batch_data = []
        for _, row in chunk.iterrows():
            batch_data.append({
                "sender": str(row['Account']), "receiver": str(row['Account.1']),
                "amount": row['amount'], "hour": int(row['hour']),
                "format": str(row['format']), "currency": str(row['currency']),
                "pay_curr": str(row['pay_curr']), "rec_curr": str(row['rec_curr']),
                "is_fraud": bool(row.get('Is Laundering', False)),
                "risk_score": float(row['risk_score']),
                "from_country": row['from_country'], "to_country": row['to_country'],
                "from_lat": float(row['from_lat']), "from_lon": float(row['from_lon']),
                "to_lat": float(row['to_lat']), "to_lon": float(row['to_lon']),
            })
        # Fresh driver connection per batch
        d = GraphDatabase.driver(URI, auth=AUTH)
        with d.session() as session:
            flush(session, batch_data, dataset_id)
        d.close()
        if i % 10000 == 0:
            print(f"  Written {i}/{len(df)}...")

    with driver.session() as s:
        s.run("MATCH (d:Dataset {id: $id}) SET d.transaction_count = $t, d.flagged_count = $f",
              id=dataset_id, t=len(df), f=flagged)

    driver.close()
    print(f"Done. {len(df)} transactions, {flagged} flagged. Dataset ID: {dataset_id}")

if __name__ == "__main__":
    ingest()
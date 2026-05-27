import os, sys, warnings, time
from datetime import datetime
import pandas as pd
from neo4j import GraphDatabase
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

warnings.filterwarnings('ignore')

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "ml"))
from model_handler import AMLInference

URI, AUTH = "bolt://localhost:7687", ("neo4j", "password123")
BATCH_SIZE = 500

# Dynamic geocoder
_geolocator = Nominatim(user_agent="aml_shadow_hunter")
_geocode = RateLimiter(_geolocator.geocode, min_delay_seconds=1)
_country_cache = {}

def geocode_country(country_name: str):
    if country_name in _country_cache:
        return _country_cache[country_name]
    try:
        location = _geocode(country_name)
        result = (location.latitude, location.longitude) if location else (0.0, 0.0)
    except Exception:
        result = (0.0, 0.0)
    _country_cache[country_name] = result
    return result

def extract_country(bank_name: str) -> str:
    if not bank_name or pd.isna(bank_name):
        return 'United States'
    non_countries = {'National', 'Savings', 'Acme', 'Willows', 'Bank', 'United', 'Federal', 'Global', 'International'}
    first_word = str(bank_name).split()[0]
    return 'United States' if first_word in non_countries else first_word

def load_account_map():
    path = os.path.join(os.path.dirname(__file__), 'data', 'HI-Small_accounts.csv')
    if not os.path.exists(path):
        return {}
    acc_df = pd.read_csv(path)
    acc_df.columns = [c.strip() for c in acc_df.columns]
    bank_col = 'Bank Name' if 'Bank Name' in acc_df.columns else acc_df.columns[0]
    acct_col = 'Account Number' if 'Account Number' in acc_df.columns else acc_df.columns[2]

    unique_countries = set(extract_country(b) for b in acc_df[bank_col].dropna().unique())
    print(f"Geocoding {len(unique_countries)} unique countries...")
    for country in unique_countries:
        geocode_country(country)

    result = {}
    for _, row in acc_df.iterrows():
        country = extract_country(row[bank_col])
        lat, lon = _country_cache.get(country, (0.0, 0.0))
        result[str(row[acct_col]).strip()] = (country, lat, lon)
    print(f"Loaded {len(result)} account-country mappings")
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

    account_map = load_account_map()

    print(f"Batch scoring {len(df)} transactions...")
    model = AMLInference()
    scores = model.predict_batch(df)
    df['risk_score'] = scores
    flagged = int((df['risk_score'] >= 0.7).sum())
    print(f"Scoring done. {flagged} flagged.")

    def get_geo(uid):
        return account_map.get(str(uid), ('United States', 0.0, 0.0))

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
    d = GraphDatabase.driver(URI, auth=AUTH)
    with d.session() as s:
        s.run("CREATE INDEX account_idx IF NOT EXISTS FOR (a:Account) ON (a.id, a.dataset_id)")
    d.close()
    time.sleep(3)
    print("Index created.")

    for i in range(0, len(df), BATCH_SIZE):
        chunk = df.iloc[i:i + BATCH_SIZE]
        batch_data = [{
            "sender": str(row['Account']), "receiver": str(row['Account.1']),
            "amount": row['amount'], "hour": int(row['hour']),
            "format": str(row['format']), "currency": str(row['currency']),
            "pay_curr": str(row['pay_curr']), "rec_curr": str(row['rec_curr']),
            "is_fraud": bool(row.get('Is Laundering', False)),
            "risk_score": float(row['risk_score']),
            "from_country": row['from_country'], "to_country": row['to_country'],
            "from_lat": float(row['from_lat']), "from_lon": float(row['from_lon']),
            "to_lat": float(row['to_lat']), "to_lon": float(row['to_lon']),
        } for _, row in chunk.iterrows()]

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
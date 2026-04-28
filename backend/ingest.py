import os
import pandas as pd
import random
from neo4j import GraphDatabase

URI = "bolt://localhost:7687"
AUTH = ("neo4j", "password123")
CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "PS_20174392719_1491204439457_log.csv")
CURRENCIES = ["USD", "EUR", "GHS", "GBP", "NGN", "KES", "ZAR"]
BATCH_SIZE = 500

def ingest(limit=50000):
    df = pd.read_csv(CSV_PATH, nrows=limit)
    df = df.dropna(subset=["nameOrig", "nameDest", "amount"])

    driver = GraphDatabase.driver(URI, auth=AUTH)
    with driver.session() as session:
        session.run("CREATE CONSTRAINT IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE")
        
        batch = []
        for _, row in df.iterrows():
            pay_curr = random.choice(CURRENCIES)
            rec_curr = random.choice(CURRENCIES)
            batch.append({
                "sender": row["nameOrig"],
                "receiver": row["nameDest"],
                "amount": float(row["amount"]),
                "hour": int(row["step"]) % 24,
                "format": row["type"],
                "currency": pay_curr,
                "pay_curr": pay_curr,
                "rec_curr": rec_curr,
                "is_fraud": bool(row["isFraud"])
            })

            if len(batch) == BATCH_SIZE:
                _flush(session, batch)
                batch = []

        if batch:
            _flush(session, batch)

    driver.close()
    print("Ingestion complete.")

def _flush(session, batch):
    session.run("""
        UNWIND $batch AS tx
        MERGE (s:Account {id: tx.sender})
        MERGE (r:Account {id: tx.receiver})
        CREATE (s)-[:TRANSFERRED {
            amount: tx.amount, hour: tx.hour, format: tx.format,
            currency: tx.currency, pay_curr: tx.pay_curr,
            rec_curr: tx.rec_curr, is_fraud: tx.is_fraud
        }]->(r)
    """, batch=batch)
    print(f"Flushed {len(batch)} transactions")

if __name__ == "__main__":
    ingest()
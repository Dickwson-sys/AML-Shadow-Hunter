import os, warnings
import torch
import joblib
import numpy as np
from model_definition import AML_GINE

warnings.filterwarnings('ignore')

FORMATS = ['ACH', 'Bitcoin', 'Cash', 'Cheque', 'Credit Card', 'Reinvestment', 'Wire']
CURRENCIES = [
    'Australian Dollar', 'Bitcoin', 'Brazil Real', 'Canadian Dollar',
    'Euro', 'Mexican Peso', 'Ruble', 'Rupee', 'Saudi Riyal', 'Shekel',
    'Swiss Franc', 'UK Pound', 'US Dollar', 'Yen', 'Yuan'
]

class AMLInference:
    def __init__(self):
        base = os.path.dirname(__file__)
        self.node_scaler = joblib.load(os.path.join(base, 'node_scaler.pkl'))
        self.edge_scaler = joblib.load(os.path.join(base, 'edge_scaler.pkl'))
        self.ohe = joblib.load(os.path.join(base, 'ohe_encoder.pkl'))
        self.model = AML_GINE(node_in_channels=2, edge_in_channels=26, hidden_channels=64)
        self.model.load_state_dict(torch.load(os.path.join(base, 'aml_model.pth'), map_location='cpu'))
        self.model.eval()

    def predict_batch(self, df_chunk):
        """
        Vectorized batch scoring — processes thousands of transactions in one forward pass.
        df_chunk: pandas DataFrame with columns: amount, hour, format, currency, pay_curr, rec_curr
        Returns: list of float risk scores
        """
        import pandas as pd
        n = len(df_chunk)
        if n == 0:
            return []

        # 1. Node features — all zeros (no degree info during ingestion)
        node_feats = np.zeros((2 * n, 2), dtype=np.float32)
        scaled_nodes = self.node_scaler.transform(np.log1p(node_feats))
        x = torch.tensor(scaled_nodes, dtype=torch.float)

        # 2. Edge index — transaction i: node 2i -> node 2i+1
        senders = np.arange(0, 2 * n, 2)
        receivers = np.arange(1, 2 * n, 2)
        edge_index = torch.tensor(np.array([senders, receivers]), dtype=torch.long)

        # 3. Edge features — vectorized
        log_amts = np.log1p(df_chunk['amount'].values.astype(float))
        hours = df_chunk['hour'].values.astype(float)
        h_sin = np.sin(2 * np.pi * hours / 23.0)
        h_cos = np.cos(2 * np.pi * hours / 23.0)
        num_feats = np.column_stack([log_amts, h_sin, h_cos])
        scaled_num = self.edge_scaler.transform(num_feats)

        # Categorical — enforce valid categories
        formats = np.array([f if f in FORMATS else 'Wire' for f in df_chunk['format'].values])
        currencies = np.array([c if c in CURRENCIES else 'US Dollar' for c in df_chunk['currency'].values])
        cat_input = np.column_stack([formats, currencies])
        cat_result = self.ohe.transform(cat_input)
        scaled_cat = cat_result.toarray() if hasattr(cat_result, 'toarray') else cat_result

        # Mismatch flag
        mismatches = (df_chunk['pay_curr'].values != df_chunk['rec_curr'].values).astype(float).reshape(-1, 1)

        edge_attr = torch.tensor(
            np.hstack([scaled_num, scaled_cat, mismatches]).astype(np.float32),
            dtype=torch.float
        )

        # 4. Single forward pass
        with torch.no_grad():
            logits = self.model(x, edge_index, edge_attr)
            probs = torch.sigmoid(logits).cpu().numpy()

        return probs.flatten().tolist()

    def predict(self, sender_stats, receiver_stats, tx_details):
        """Single transaction — kept for compatibility."""
        import pandas as pd
        df = pd.DataFrame([tx_details])
        return self.predict_batch(df)[0]
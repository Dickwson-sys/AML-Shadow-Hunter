import os
import torch
import joblib
import numpy as np
import pandas as pd
from model_definition import AML_GINE

class AMLInference:
    def __init__(self):
       base = os.path.dirname(__file__)
       self.node_scaler = joblib.load(os.path.join(base, 'node_scaler.pkl'))
       self.edge_scaler = joblib.load(os.path.join(base, 'edge_scaler.pkl'))
       self.ohe = joblib.load(os.path.join(base, 'ohe_encoder.pkl'))
       self.model = AML_GINE(node_in_channels=2, edge_in_channels=15, hidden_channels=64)
       self.model.load_state_dict(torch.load(os.path.join(base, 'aml_model.pth'), map_location='cpu'))
       self.model.eval()

    def predict(self, sender_stats, receiver_stats, tx_details):
        """
        sender_stats: [in_degree, out_degree]
        tx_details: {'amount': float, 'hour': int, 'format': str, 'currency': str ,'pay_curr':str,'rec_curr':str }
        """
        with torch.no_grad():
            # --- Scale Node Features ---
            s_feat = self.node_scaler.transform([np.log1p(sender_stats)])
            r_feat = self.node_scaler.transform([np.log1p(receiver_stats)])
            x = torch.tensor(np.vstack([s_feat, r_feat]), dtype=torch.float)
            
            # --- Scale Edge Features ---
            log_amt = np.log1p(tx_details['amount'])
            h_sin = np.sin(2 * np.pi * tx_details['hour'] / 23.0)
            h_cos = np.cos(2 * np.pi * tx_details['hour'] / 23.0)
            
            scaled_num = self.edge_scaler.transform([[log_amt, h_sin, h_cos]])
            cat_feat = self.ohe.transform([[tx_details['format'], tx_details['currency']]])
            # Mismatch flag: 1 if currencies differ, else 0
            mismatch = 1.0 if tx_details['pay_curr'] != tx_details['rec_curr'] else 0.0
            
            edge_attr = torch.tensor(np.hstack([scaled_num, cat_feat, [[mismatch]]]), dtype=torch.float)
            edge_index = torch.tensor([[0], [1]], dtype=torch.long) # Local link between 0 and 1
            
            # --- Inference ---
            logits = self.model(x, edge_index, edge_attr)
            prob = torch.sigmoid(logits).item()
            return prob

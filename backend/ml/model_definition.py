import torch
import torch.nn as nn
from torch_geometric.nn import GINEConv

class AML_GINE(nn.Module):
    def __init__(self, node_in_channels, edge_in_channels, hidden_channels):
        super(AML_GINE, self).__init__()
        
        # Mapping Edge features
        self.edge_mlp = nn.Sequential(
            nn.Linear(edge_in_channels, hidden_channels),
            nn.ReLU(),
            nn.Linear(hidden_channels, hidden_channels)
        )
        
        # GINE Layers
        gin_mlp1 = nn.Sequential(
            nn.Linear(node_in_channels, hidden_channels),
            nn.ReLU(),
            nn.Linear(hidden_channels, hidden_channels)
        )
        self.conv1 = GINEConv(gin_mlp1, edge_dim=hidden_channels)
        self.bn1 = nn.BatchNorm1d(hidden_channels)
        
        gin_mlp2 = nn.Sequential(
            nn.Linear(hidden_channels, hidden_channels),
            nn.ReLU(),
            nn.Linear(hidden_channels, hidden_channels)
        )
        self.conv2 = GINEConv(gin_mlp2, edge_dim=hidden_channels)
        self.bn2 = nn.BatchNorm1d(hidden_channels)
        
        # Final Classifier
        self.classifier = nn.Sequential(
            nn.Linear(hidden_channels * 2 + edge_in_channels, hidden_channels),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_channels, 1)
        )

    def forward(self, x, edge_index, edge_attr, mask=None):
        processed_edge_attr = self.edge_mlp(edge_attr)
        h = self.conv1(x, edge_index, processed_edge_attr)
        h = self.bn1(h).relu()
        h = self.conv2(h, edge_index, processed_edge_attr)
        h = self.bn2(h).relu()

        if mask is not None:
            target_edge_index = edge_index[:, mask]
            target_edge_attr = edge_attr[mask]
        else:
            target_edge_index = edge_index
            target_edge_attr = edge_attr

        row, col = target_edge_index
        edge_rep = torch.cat([h[row], h[col], target_edge_attr], dim=-1)
        return self.classifier(edge_rep).squeeze()

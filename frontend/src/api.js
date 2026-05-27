import axios from 'axios'

const api = axios.create({ baseURL: 'http://localhost:8000' })

export const getDatasets = () => api.get('/datasets')
export const deleteDataset = (id) => api.delete(`/datasets/${id}`)
export const previewColumns = (file) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post('/upload/preview', fd)
}
export const uploadDataset = (file, mapping, name) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post('/upload', fd, { params: { ...mapping, dataset_name: name } })
}
export const getAlerts = (dataset_id, threshold = 0.7) =>
  api.get('/alerts/suspicious', { params: { dataset_id, threshold } })
export const getNetwork = (account_id, dataset_id) =>
  api.get(`/account/${account_id}/network`, { params: { dataset_id } })
export const getStats = (dataset_id) =>
  api.get('/stats', { params: { dataset_id } })
export const getTopSuspicious = (dataset_id, threshold = 0.7) =>
  api.get('/accounts/top-suspicious', { params: { dataset_id, threshold } })
import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
const api = axios.create({ baseURL: API_BASE, timeout: 60000 });

export function errorMessage(error) {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) return detail.map((item) => item.msg || JSON.stringify(item)).join(', ');
  return detail || error?.message || 'Something went wrong. Please try again.';
}

export async function fetchDatasets() {
  const { data } = await api.get('/api/datasets');
  return data.datasets;
}

export async function fetchDashboard(datasetId, filters = {}) {
  const { data } = await api.get('/api/dashboard', { params: { dataset_id: datasetId, ...filters } });
  return data;
}

export async function fetchRecords(params) {
  const { data } = await api.get('/api/records', { params });
  return data;
}

export async function previewFile(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/api/data/preview', form);
  return data;
}

export async function importFile({ file, mapping, datasetName, currency }) {
  const form = new FormData();
  form.append('file', file);
  form.append('mapping_json', JSON.stringify(mapping));
  form.append('dataset_name', datasetName);
  form.append('currency', currency);
  const { data } = await api.post('/api/data/analyze', form);
  return data;
}

export async function deleteDataset(datasetId) {
  const { data } = await api.delete(`/api/datasets/${datasetId}`);
  return data;
}

export function buildExportUrl(path, params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '' && value !== 'All') query.set(key, String(value));
  });
  return `${API_BASE}${path}?${query.toString()}`;
}

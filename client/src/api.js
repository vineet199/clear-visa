import axios from "axios";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const fallbackBaseUrl = import.meta.env.DEV ? "http://localhost:4000/api" : "/api";

const baseURL = (configuredBaseUrl || fallbackBaseUrl).replace(/\/$/, "");

if (!import.meta.env.DEV && !configuredBaseUrl) {
  console.warn(
    "VITE_API_BASE_URL is not set. Production API requests will use /api, which only works if a reverse proxy is configured."
  );
}

const api = axios.create({
  baseURL,
});

export function setAuthToken(token) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

export const register = (payload) => api.post("/auth/register", payload).then((r) => r.data);
export const login = (payload) => api.post("/auth/login", payload).then((r) => r.data);
export const analyzeProfile = (payload) => api.post("/visa/analyze", payload).then((r) => r.data);
export const calculateScore = (payload) => api.post("/visa/score", payload).then((r) => r.data);
export const fetchChecklist = (profileId, visaCode) =>
  api.get(`/visa/checklist/${profileId}/${visaCode}`).then((r) => r.data);
export const saveVisaOption = (payload) => api.post("/visa/save-option", payload).then((r) => r.data);
export const listSavedOptions = () => api.get("/visa/saved-options").then((r) => r.data);
export const askChat = (payload) => api.post("/chat", payload).then((r) => r.data);

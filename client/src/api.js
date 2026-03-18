import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:4000/api",
});

export function setAuthToken(token) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

export const register = (payload) => api.post("/auth/register", payload).then((r) => r.data);
export const login = (payload) => api.post("/auth/login", payload).then((r) => r.data);
export const analyzeProfile = (payload) => api.post("/visa/analyze", payload).then((r) => r.data);
export const fetchChecklist = (profileId, visaCode) =>
  api.get(`/visa/checklist/${profileId}/${visaCode}`).then((r) => r.data);
export const saveVisaOption = (payload) => api.post("/visa/save-option", payload).then((r) => r.data);
export const listSavedOptions = () => api.get("/visa/saved-options").then((r) => r.data);
export const askChat = (payload) => api.post("/chat", payload).then((r) => r.data);

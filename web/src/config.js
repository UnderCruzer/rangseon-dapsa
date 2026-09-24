// API 서버 주소. 웹 개발 중에는 비워 두면 Vite 프록시(/api → 8787)를 탄다.
// 앱 빌드에서는 배포된 서버 주소를 VITE_API_BASE로 넣는다 (예: https://trip3d-api.example.com).
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export const apiUrl = (path) => `${API_BASE}${path}`;

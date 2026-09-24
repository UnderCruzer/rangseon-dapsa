import { defineConfig } from "vite";

const API_PORT = process.env.API_PORT ?? 8787;

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // maplibre·three·spark가 커서 경고 기준을 올린다 (1인칭 뷰어는 동적 import로 분리됨)
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${API_PORT}` },
  },
});

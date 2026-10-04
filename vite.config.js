import { defineConfig } from "vite";

const API_PORT = process.env.API_PORT ?? 8787;

export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // 1인칭 뷰어 청크(three + Spark, WASM 포함)가 약 3MB라 기준을 올린다. 동적 import라 첫 화면에는 안 실림.
    chunkSizeWarningLimit: 3200,
  },
  server: {
    port: 5173,
    // /mock-photo.svg는 npm run dev:mock 전용 (목업 API가 줌)
    proxy: { "/api": `http://localhost:${API_PORT}`, "/mock-photo.svg": `http://localhost:${API_PORT}` },
  },
});

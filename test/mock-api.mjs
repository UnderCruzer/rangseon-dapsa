// 키 없이 화면을 개발·확인하기 위한 목업 API. /api/plan이 항상 test/fixtures/mock-trip.json을 돌려준다.
// /api/route는 키 없는 실제 로직(도보·직선 추정)을 그대로 쓴다.
// 사용: npm run dev:mock  (목업 API :8787 + Vite :5173)
import http from "node:http";
import { readFileSync } from "node:fs";
import { route } from "../lib/route.js";

const PORT = Number(process.env.API_PORT ?? 8787);
const trip = () => readFileSync(new URL("./fixtures/mock-trip.json", import.meta.url), "utf8");
const photo = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="144"><rect width="100%" height="100%" fill="#2a6f97"/><text x="50%" y="54%" font-family="sans-serif" font-size="16" text-anchor="middle" fill="#fff">목업 사진</text></svg>`;

http
  .createServer(async (req, res) => {
    const send = (status, type, body) => { res.writeHead(status, { "Content-Type": type }); res.end(body); };
    if (req.url === "/api/config") return send(200, "application/json", JSON.stringify({ llm: true, googleMapsKey: null }));
    if (req.url === "/api/plan" && req.method === "POST") return setTimeout(() => send(200, "application/json", trip()), 800);
    if (req.url.startsWith("/api/route")) {
      const q = new URL(req.url, "http://x").searchParams;
      const [fl, fa] = q.get("from").split(",").map(Number);
      const [tl, ta] = q.get("to").split(",").map(Number);
      const { errors, ...body } = await route({ lng: fl, lat: fa }, { lng: tl, lat: ta });
      return send(200, "application/json", JSON.stringify(body));
    }
    if (req.url === "/mock-photo.svg") return send(200, "image/svg+xml", photo);
    send(404, "application/json", '{"error":"not found"}');
  })
  .listen(PORT, () => console.log(`목업 API → http://localhost:${PORT}`));

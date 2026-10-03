import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { distanceKm } from "./lib/geo.js";
import * as tourapi from "./lib/tourapi.js";
import { route } from "./lib/route.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// 개발 중에는 Vite(5173)가 화면을, 이 서버(8787)가 /api를 맡는다. 운영에서는 빌드된 dist/도 같이 서빙.
const STATIC_DIR = path.join(here, "dist");
// API_PORT가 우선: 개발 도구가 PORT를 Vite 포트로 넣어 두는 경우가 있어서. 호스팅은 보통 PORT만 준다.
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
const HAS_LLM = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const TOURAPI_KEY = process.env.TOURAPI_KEY || null;
const ROUTE_KEYS = { odsayKey: process.env.ODSAY_KEY || null, kakaoKey: process.env.KAKAO_REST_KEY || null };

const client = HAS_LLM ? new Anthropic() : null;

// ---------- 일정 스키마 ----------
const Stop = z.object({
  name: z.string().describe("한국어 장소명"),
  query: z.string().describe("지오코딩용 검색어. 현지 공식 명칭(현지어) + 도시명. 예: '浅草寺 東京', '해운대해수욕장 부산'"),
  lat: z.number(),
  lng: z.number(),
  day: z.number().int().describe("1부터 시작하는 일차"),
  time: z.string().describe("도착 예정 시각 HH:MM (24시간)"),
  stay_minutes: z.number().int(),
  category: z.string().describe("명소 / 자연 / 음식 / 카페 / 쇼핑 / 야경 / 문화 / 숙소 중 하나"),
  description: z.string().describe("이 장소에 도착했을 때 눈앞에 보이는 풍경을 2문장으로 생생하게"),
  tip: z.string().describe("실제로 갈 때 도움 되는 구체적 팁 1문장 (혼잡 시간, 입장료, 포토스팟 등)"),
  move_from_prev: z.string().describe("이전 장소에서 오는 방법과 대략 소요 시간. 첫 장소는 빈 문자열"),
});

const Itinerary = z.object({
  title: z.string(),
  city: z.string(),
  summary: z.string().describe("여행 전체 한 줄 요약"),
  stops: z.array(Stop),
});

const SYSTEM = `당신은 현지 사정을 잘 아는 여행 플래너입니다.
사용자의 한 줄 요청을 실제로 다닐 수 있는 동선의 일정으로 만듭니다.
- 장소는 반드시 실존하는 곳만, 5~9곳. 좌표는 아는 한 정확하게.
- 같은 날 안에서는 지리적으로 효율적인 순서로, 이동 시간이 비현실적이지 않게.
- 요청에 기간이 없으면 당일치기로 가정.
- 시간대가 풍경에 영향을 주는 곳(일몰, 야경)은 그 시간에 배치.
- 국내 장소 이름은 한국관광공사·지도 앱에 등록된 공식 명칭으로 쓴다 (예: "해운대해수욕장", "감천문화마을"). 부가 설명은 괄호로 뒤에.`;

// ---------- 좌표 검증: TourAPI → OSM Nominatim ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": "rangseon-dapsa/0.1 (github.com/UnderCruzer/rangseon-dapsa)", "Accept-Language": "ko" } });
  if (!res.ok) return null;
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

// 1순위 TourAPI(공식 좌표·사진·주소), 2순위 Nominatim(LLM 좌표 5km 안), 둘 다 실패하면 LLM 좌표 유지
// verified: "tourapi" | "osm" | false
async function verifyStops(stops) {
  for (const stop of stops) {
    if (TOURAPI_KEY) {
      try {
        const hit = await tourapi.lookup(TOURAPI_KEY, stop);
        if (hit) {
          Object.assign(stop, {
            verified: "tourapi",
            lat: hit.lat,
            lng: hit.lng,
            photo: hit.photo,
            address: hit.address,
            contentId: hit.contentId,
          });
          continue;
        }
      } catch (err) {
        console.warn(`[tourapi] ${stop.name}:`, err.message);
      }
    }
    try {
      const hit = await geocode(stop.query);
      stop.verified = hit && distanceKm(hit, stop) < 5 ? "osm" : false;
      if (stop.verified) Object.assign(stop, { lat: hit.lat, lng: hit.lng });
    } catch {
      stop.verified = false;
    }
    await sleep(1100); // Nominatim 이용 정책: 초당 1건
  }
  return stops;
}

async function planTrip(prompt) {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(Itinerary) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("요청을 처리할 수 없습니다.");
  if (!response.parsed_output) throw new Error("일정을 해석하지 못했습니다.");
  const trip = response.parsed_output;
  trip.stops = await verifyStops(trip.stops);
  return trip;
}

// ---------- 구간 이동 ----------
// 같은 일정을 다시 열 때 외부 API를 또 부르지 않게 메모리에 둔다 (프로세스 재시작 시 비움)
const routeCache = new Map();

function parseLngLat(s) {
  const [lng, lat] = (s ?? "").split(",").map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lng, lat } : null;
}

// ---------- HTTP ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/config") {
    return sendJson(res, 200, {
      llm: HAS_LLM,
      googleMapsKey: process.env.GOOGLE_MAPS_API_KEY ?? null,
    });
  }

  if (url.pathname === "/api/route") {
    const from = parseLngLat(url.searchParams.get("from"));
    const to = parseLngLat(url.searchParams.get("to"));
    if (!from || !to) return sendJson(res, 400, { error: "from, to는 '경도,위도' 형식" });
    const cacheKey = `${from.lng},${from.lat}>${to.lng},${to.lat}`;
    if (!routeCache.has(cacheKey)) {
      routeCache.set(cacheKey, route(from, to, ROUTE_KEYS));
    }
    try {
      const result = await routeCache.get(cacheKey);
      if (result.errors) console.warn("[route]", result.errors.join(" / "));
      const { errors, ...body } = result;
      return sendJson(res, 200, body);
    } catch (err) {
      routeCache.delete(cacheKey);
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (url.pathname === "/api/plan" && req.method === "POST") {
    if (!client) return sendJson(res, 503, { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." });
    try {
      const { prompt } = await readBody(req);
      if (!prompt?.trim()) return sendJson(res, 400, { error: "프롬프트가 비어 있습니다." });
      return sendJson(res, 200, await planTrip(prompt.trim()));
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        console.error(`[plan] API ${err.status}:`, err.message);
        return sendJson(res, 502, { error: `Claude API 오류 (${err.status})` });
      }
      console.error("[plan]", err);
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 정적 파일 (npm run build 결과물)
  const filePath = path.join(STATIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(STATIC_DIR)) return sendJson(res, 403, { error: "forbidden" });
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "not found" });
  }
});

server.listen(PORT, () => {
  console.log(
    `랑선답사 api → http://localhost:${PORT}  (Claude: ${HAS_LLM ? "on" : "off, 데모 모드"}, TourAPI: ${TOURAPI_KEY ? "on" : "off"}, ODsay: ${ROUTE_KEYS.odsayKey ? "on" : "off"}, 카카오: ${ROUTE_KEYS.kakaoKey ? "on" : "off"})`,
  );
});

// 한국관광공사 TourAPI (KorService2) — 장소 검증·사진·주소
// https://www.data.go.kr/data/15101578/openapi.do
import { distanceKm } from "./geo.js";

const BASE = "https://apis.data.go.kr/B551011/KorService2";
const APP = "rangseon-dapsa";
export const MATCH_RADIUS_KM = 3;
// 0.4면 지명만 겹쳐도("해운대 국밥" ↔ "해운대해수욕장") 통과해서 0.5
const MIN_SCORE = 0.5;

// "해운대 블루라인파크 (스카이캡슐)" → "해운대 블루라인파크": 괄호 속 부가 설명은 검색을 방해한다
export function searchKeyword(name) {
  return name.replace(/\s*[(（][^)）]*[)）]\s*/g, " ").trim();
}

export function searchUrl(key, keyword, rows = 20) {
  const q = new URLSearchParams({
    MobileOS: "ETC",
    MobileApp: APP,
    _type: "json",
    numOfRows: String(rows),
    pageNo: "1",
    keyword,
  });
  return `${BASE}/searchKeyword2?serviceKey=${encodeKey(key)}&${q}`;
}

// 공공데이터포털은 인코딩 키(%2B…)와 디코딩 키(+, /, =)를 둘 다 준다. 어느 쪽을 넣어도 한 번만 인코딩되게
export function encodeKey(key) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

// 응답 → 장소 배열. 결과가 없으면 items가 빈 문자열로 오고, 1건이면 배열이 아닌 객체로 올 수 있다
export function parseItems(json) {
  const header = json?.response?.header;
  if (header && header.resultCode !== "0000") {
    throw new Error(`TourAPI ${header.resultCode}: ${header.resultMsg}`);
  }
  const raw = json?.response?.body?.items?.item;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((it) => ({
      contentId: String(it.contentid),
      contentTypeId: String(it.contenttypeid),
      title: it.title ?? "",
      address: [it.addr1, it.addr2].filter(Boolean).join(" ").trim(),
      lat: Number(it.mapy),
      lng: Number(it.mapx),
      photo: httpsPhoto(it.firstimage || it.firstimage2),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat !== 0);
}

// 앱(WebView)은 https 출처라 http 이미지는 혼합 콘텐츠로 막힌다
export function httpsPhoto(url) {
  if (!url) return null;
  return url.replace(/^http:\/\//, "https://");
}

// 이름 유사도 0~1: 공백·기호 제거 후 완전 일치 1, 포함 0.8, 그 외 글자 2-gram Dice 계수
export function nameScore(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[\s()（）\[\]·.,\-_/]/g, "");
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  const grams = (s) => new Set([...s].slice(0, -1).map((c, i) => c + s[i + 1]));
  const gx = grams(x);
  const gy = grams(y);
  if (!gx.size || !gy.size) return 0;
  let hit = 0;
  for (const g of gx) if (gy.has(g)) hit++;
  return (2 * hit) / (gx.size + gy.size);
}

// LLM이 준 장소와 가장 잘 맞는 TourAPI 결과. 반경 안에서 이름이 가장 비슷한 곳, 같으면 가까운 곳
export function pickBest(stop, candidates) {
  let best = null;
  for (const c of candidates) {
    const km = distanceKm(stop, c);
    if (km > MATCH_RADIUS_KM) continue;
    const score = nameScore(stop.name, c.title);
    if (score < MIN_SCORE) continue;
    if (!best || score > best.score || (score === best.score && km < best.km)) best = { ...c, score, km };
  }
  return best;
}

export async function lookup(key, stop, fetchImpl = fetch) {
  const res = await fetchImpl(searchUrl(key, searchKeyword(stop.name)));
  if (!res.ok) throw new Error(`TourAPI HTTP ${res.status}`);
  const text = await res.text();
  // 키 오류 등은 JSON이 아니라 XML로 돌아온다
  if (!text.trimStart().startsWith("{")) throw new Error(`TourAPI 응답 오류: ${text.slice(0, 120)}`);
  return pickBest(stop, parseItems(JSON.parse(text)));
}

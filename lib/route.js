// 구간 이동: 도보 추정 / ODsay 대중교통 / 카카오모빌리티 자동차 / 직선 추정
// ODsay: https://lab.odsay.com/guide/guide   카카오모빌리티: https://developers.kakaomobility.com
import { distanceKm } from "./geo.js";

export const WALK_MAX_KM = 1.2;
const WALK_KMH = 4.5;
const DETOUR = 1.3; // 직선 대비 실제 길 비율 (대략)
const CITY_KMH = 22; // 키가 없을 때 쓰는 시내 이동 평균 속도 (대중교통·차량 섞어서 대략)

export const MODE_LABEL = { walk: "도보", transit: "대중교통", car: "자동차", estimate: "이동" };

export function estimateWalk(from, to) {
  const km = distanceKm(from, to) * DETOUR;
  return { mode: "walk", minutes: Math.max(1, Math.round((km / WALK_KMH) * 60)), km: round1(km), estimated: true };
}

export function estimateCity(from, to) {
  const km = distanceKm(from, to) * DETOUR;
  return { mode: "estimate", minutes: Math.max(5, Math.round((km / CITY_KMH) * 60) + 5), km: round1(km), estimated: true };
}

// ---------- ODsay 대중교통 ----------
export function odsayUrl(key, from, to) {
  const q = new URLSearchParams({ SX: from.lng, SY: from.lat, EX: to.lng, EY: to.lat, apiKey: key });
  return `https://api.odsay.com/v1/api/searchPubTransPathT?${q}`;
}

// 오류는 { error: { code, msg } } 또는 { error: [{ code, message }] } 로 온다
export function parseOdsay(json) {
  const err = Array.isArray(json?.error) ? json.error[0] : json?.error;
  if (err) throw new Error(`ODsay ${err.code}: ${err.msg ?? err.message}`);
  const paths = json?.result?.path ?? [];
  if (!paths.length) return null;
  const best = paths.reduce((a, b) => (b.info.totalTime < a.info.totalTime ? b : a));
  const legs = (best.subPath ?? [])
    .filter((s) => s.trafficType === 1 || s.trafficType === 2)
    .map((s) => (s.trafficType === 1 ? s.lane?.[0]?.name ?? "지하철" : `버스 ${s.lane?.[0]?.busNo ?? ""}`.trim()));
  return {
    mode: "transit",
    minutes: best.info.totalTime,
    km: round1((best.info.totalDistance ?? 0) / 1000),
    summary: legs.join(" → "),
    fare: best.info.payment ?? null,
    estimated: false,
  };
}

// ---------- 카카오모빌리티 자동차 ----------
export function kakaoUrl(from, to) {
  const q = new URLSearchParams({ origin: `${from.lng},${from.lat}`, destination: `${to.lng},${to.lat}`, summary: "false" });
  return `https://apis-navi.kakaomobility.com/v1/directions?${q}`;
}

export function parseKakao(json) {
  const r = json?.routes?.[0];
  if (!r) return null;
  if (r.result_code !== 0) throw new Error(`Kakao ${r.result_code}: ${r.result_msg}`);
  // vertexes는 [x1, y1, x2, y2, ...] (경도, 위도)
  const path = [];
  for (const section of r.sections ?? []) {
    for (const road of section.roads ?? []) {
      const v = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) path.push([v[i], v[i + 1]]);
    }
  }
  return {
    mode: "car",
    minutes: Math.max(1, Math.round(r.summary.duration / 60)),
    km: round1(r.summary.distance / 1000),
    path: path.length > 1 ? path : null,
    estimated: false,
  };
}

// ---------- 구간 계산 ----------
// 가까우면 도보, 아니면 대중교통 → 자동차 → 직선 추정 순으로 추천. 받을 수 있는 수단은 options에 모두 담는다
export async function route(from, to, { odsayKey, kakaoKey, fetchImpl = fetch } = {}) {
  const options = [];
  const walk = estimateWalk(from, to);
  if (distanceKm(from, to) <= WALK_MAX_KM) {
    return { best: walk, options: [walk] };
  }
  const errors = [];
  if (odsayKey) {
    try {
      const t = parseOdsay(await (await fetchImpl(odsayUrl(odsayKey, from, to))).json());
      if (t) options.push(t);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (kakaoKey) {
    try {
      const res = await fetchImpl(kakaoUrl(from, to), { headers: { Authorization: `KakaoAK ${kakaoKey}` } });
      const c = parseKakao(await res.json());
      if (c) options.push(c);
    } catch (e) {
      errors.push(e.message);
    }
  }
  const best = options[0] ?? estimateCity(from, to);
  if (!options.length) options.push(best);
  return errors.length ? { best, options, errors } : { best, options };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

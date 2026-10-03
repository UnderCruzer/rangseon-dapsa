// 구간(이전 장소 → 이 장소) 이동 정보: 서버 /api/route 결과를 stop.leg에 붙이고, 경고·표시 문구를 만든다
import { apiUrl } from "./config.js";

const MODE_LABEL = { walk: "도보", transit: "대중교통", car: "자동차", estimate: "이동" };
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

export function distanceKm(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// 지도에 그릴 구간 좌표. 실제 도로 경로가 있으면 그걸, 없으면 직선
export function legCoordinates(prev, stop) {
  return stop.leg?.path ?? [[prev.lng, prev.lat], [stop.lng, stop.lat]];
}

// 같은 날 연속 구간마다 /api/route를 불러 stop.leg를 채운다. 실패한 구간은 leg 없이 둔다(직선 기반 경고로 대체)
export async function loadLegs(stops) {
  await Promise.all(
    stops.map(async (stop, i) => {
      const prev = stops[i - 1];
      if (!prev || prev.day !== stop.day) return;
      try {
        const res = await fetch(apiUrl(`/api/route?from=${prev.lng},${prev.lat}&to=${stop.lng},${stop.lat}`));
        if (!res.ok) return;
        stop.leg = (await res.json()).best;
      } catch {
        // 앱에서 API 서버가 없을 때 등: 무시
      }
    }),
  );
}

// 카드 "이동" 줄
export function legText(stop) {
  const leg = stop.leg;
  if (!leg) return stop.move_from_prev ? `이동: ${stop.move_from_prev}` : "";
  if (leg.mode === "estimate") return `이동: 약 ${leg.minutes}분 · ${leg.km}km (직선 추정)`;
  const parts = [`${MODE_LABEL[leg.mode] ?? "이동"} ${leg.minutes}분`];
  if (leg.summary) parts.push(leg.summary);
  if (leg.km) parts.push(`${leg.km}km`);
  return `이동: ${parts.join(" · ")}${leg.estimated ? " (추정)" : ""}`;
}

// 이전 장소를 떠나는 시각 ~ 이 장소 도착 시각 사이에 이동이 들어가는지
export function legWarning(prev, stop) {
  if (!prev || prev.day !== stop.day) return "";
  const gap = toMin(stop.time) - (toMin(prev.time) + prev.stay_minutes);
  if (gap < 0) return `이전 일정과 ${-gap}분 겹침`;
  if (stop.leg) {
    if (stop.leg.minutes > gap) {
      const label = stop.leg.mode === "estimate" ? "이동 약" : MODE_LABEL[stop.leg.mode];
      return `${label} ${stop.leg.minutes}분${stop.leg.estimated ? "(추정)" : ""}인데 간격 ${gap}분`;
    }
    return "";
  }
  // 이동 정보가 없으면 직선거리로 대략 점검
  const km = distanceKm(prev, stop);
  if (km > 0.8 && (km / Math.max(gap, 1)) * 60 > 25) return `직선 ${km.toFixed(1)}km를 ${gap}분에 이동, 빠듯함`;
  return "";
}

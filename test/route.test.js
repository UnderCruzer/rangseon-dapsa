import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateWalk, estimateCity, odsayUrl, parseOdsay, kakaoUrl, parseKakao, route } from "../lib/route.js";

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const haeundae = { lat: 35.1587, lng: 129.1604 };
const gwangalli = { lat: 35.1532, lng: 129.1186 };
const dongbaek = { lat: 35.1532, lng: 129.152 }; // 해운대에서 약 1km

test("도보 추정: 직선 × 1.3, 시속 4.5km", () => {
  const w = estimateWalk(haeundae, dongbaek);
  assert.equal(w.mode, "walk");
  assert.ok(w.minutes >= 12 && w.minutes <= 20, `${w.minutes}분`);
  assert.equal(w.estimated, true);
});

test("ODsay: 가장 빠른 경로를 고르고 환승 요약을 만든다", () => {
  const t = parseOdsay(load("odsay-path.json"));
  assert.deepEqual(t, { mode: "transit", minutes: 35, km: 11.9, summary: "버스 139", fare: 1550, estimated: false });
});

test("ODsay: 지하철·버스 환승 요약", () => {
  const json = load("odsay-path.json");
  json.result.path = [json.result.path[0]];
  assert.equal(parseOdsay(json).summary, "버스 1003 → 부산 2호선");
});

test("ODsay: 오류 응답 두 가지 형태 모두 예외", () => {
  assert.throws(() => parseOdsay({ error: { code: "-98", msg: "출, 도착지가 700m이내입니다." } }), /ODsay -98/);
  assert.throws(() => parseOdsay({ error: [{ code: "500", message: "서버 오류" }] }), /ODsay 500/);
  assert.equal(parseOdsay({ result: { path: [] } }), null);
});

test("ODsay URL은 경도=SX, 위도=SY", () => {
  const u = new URL(odsayUrl("k+e/y", haeundae, gwangalli));
  assert.equal(u.searchParams.get("SX"), "129.1604");
  assert.equal(u.searchParams.get("SY"), "35.1587");
  assert.equal(u.searchParams.get("apiKey"), "k+e/y");
});

test("카카오: 시간·거리·도로 좌표", () => {
  const c = parseKakao(load("kakao-directions.json"));
  assert.equal(c.mode, "car");
  assert.equal(c.minutes, 21);
  assert.equal(c.km, 9.8);
  assert.equal(c.path.length, 5);
  assert.deepEqual(c.path[0], [129.1604, 35.1587]);
  assert.match(kakaoUrl(haeundae, gwangalli), /origin=129\.1604%2C35\.1587/);
});

test("카카오: 실패 코드는 예외", () => {
  assert.throws(() => parseKakao({ routes: [{ result_code: 104, result_msg: "출발지와 도착지가 5 m 이내로 설정된 경우 경로를 탐색할 수 없음" }] }), /Kakao 104/);
});

test("route: 1.2km 이내면 키와 상관없이 도보", async () => {
  const fetchImpl = () => assert.fail("가까운 구간은 API를 부르지 않아야 함");
  const r = await route(haeundae, dongbaek, { odsayKey: "k", kakaoKey: "k", fetchImpl });
  assert.equal(r.best.mode, "walk");
});

test("route: 키가 없으면 직선 추정", async () => {
  const r = await route(haeundae, gwangalli);
  assert.equal(r.best.mode, "estimate");
  assert.equal(r.best.estimated, true);
  assert.deepEqual(r.options, [r.best]);
  assert.deepEqual(estimateCity(haeundae, gwangalli), r.best);
});

test("route: 대중교통을 먼저 추천하고 자동차도 선택지에 담는다", async () => {
  const fetchImpl = async (url, opts) => {
    if (url.includes("odsay")) return new Response(JSON.stringify(load("odsay-path.json")));
    assert.equal(opts.headers.Authorization, "KakaoAK kk");
    return new Response(JSON.stringify(load("kakao-directions.json")));
  };
  const r = await route(haeundae, gwangalli, { odsayKey: "ok", kakaoKey: "kk", fetchImpl });
  assert.equal(r.best.mode, "transit");
  assert.deepEqual(r.options.map((o) => o.mode), ["transit", "car"]);
});

test("route: 한쪽 API가 실패해도 다른 쪽 결과를 쓰고 오류를 남긴다", async () => {
  const fetchImpl = async (url) =>
    url.includes("odsay")
      ? new Response(JSON.stringify({ error: { code: "-8", msg: "API 키 오류" } }))
      : new Response(JSON.stringify(load("kakao-directions.json")));
  const r = await route(haeundae, gwangalli, { odsayKey: "bad", kakaoKey: "kk", fetchImpl });
  assert.equal(r.best.mode, "car");
  assert.match(r.errors[0], /ODsay -8/);
});

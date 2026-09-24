import "pretendard/dist/web/variable/pretendardvariable.css";
import "./style.css";
import { MapLibreRenderer, phaseOf } from "./renderer-maplibre.js";
import { apiUrl } from "./config.js";
import { setupNative, keepAwake } from "./native.js";
import { pickPreset } from "./presets.js";
import { sceneFor } from "./scenes.js";
import { Sheet } from "./sheet.js";

const DWELL_MS = 9000; // 한 장소에 머무는 시간(자동 투어)
const DAY_COLORS = ["#ffb547", "#5ec8ff", "#b98cff", "#7be3a0"];
const EXAMPLES = [
  "부산 당일치기, 바다 위주로 걷고 야경으로 마무리",
  "서울 처음 오는 친구랑 고궁이랑 남산",
  "도쿄 하루, 옛 거리부터 시부야 밤까지",
];

const $ = (id) => document.getElementById(id);
const state = {
  config: { llm: false, googleMapsKey: null },
  trip: null,
  index: -1,
  playing: true,
  token: 0,       // 진행 중인 이동을 무효화하기 위한 세대 번호
  timer: null,
  renderers: {},
  renderer: null,
};

const colorOf = (stop) => DAY_COLORS[(stop.day - 1) % DAY_COLORS.length];
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

function distanceKm(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// 이전 장소를 떠나는 시각 ~ 다음 도착 시각 사이에 직선거리를 소화할 수 있는지 대략 점검
function legWarning(prev, stop) {
  if (!prev || prev.day !== stop.day) return "";
  const gap = toMin(stop.time) - (toMin(prev.time) + prev.stay_minutes);
  const km = distanceKm(prev, stop);
  if (gap < 0) return `이전 일정과 ${-gap}분 겹침`;
  if (km > 0.8 && km / Math.max(gap, 1) * 60 > 25) return `직선 ${km.toFixed(1)}km를 ${gap}분에 이동, 빠듯함`;
  return "";
}

function roadviewUrl({ lat, lng }) {
  const inKorea = lat > 33 && lat < 38.7 && lng > 124.5 && lng < 131.9;
  return inKorea
    ? `https://map.kakao.com/link/roadview/${lat},${lng}`
    : `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

// ---------- 상태 표시 ----------
function setStatus(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

function setClock(time) {
  const phase = phaseOf(toMin(time) / 60);
  $("clock-time").textContent = time;
  $("clock-icon").textContent = { day: "☀", golden: "◐", night: "☾" }[phase];
  state.renderer.setPhase(phase);
}

// ---------- 일정 목록 ----------
function renderList(trip) {
  $("trip").hidden = false;
  $("trip-title").textContent = trip.title;
  $("trip-summary").textContent = trip.summary;
  const list = $("stops");
  list.replaceChildren();
  let day = 0;
  trip.stops.forEach((stop, i) => {
    if (stop.day !== day) {
      day = stop.day;
      const label = document.createElement("li");
      label.className = "day-label";
      label.textContent = `DAY ${day}`;
      list.append(label);
    }
    const li = document.createElement("li");
    li.className = "stop";
    li.dataset.index = i;
    li.style.setProperty("--c", colorOf(stop));
    const warn = legWarning(trip.stops[i - 1], stop);
    li.innerHTML = `
      <span class="num">${i + 1}</span>
      <div>
        <div class="name"></div>
        <div class="sub"></div>
        ${warn ? `<span class="warn">⚠ ${warn}</span>` : ""}
      </div>`;
    li.querySelector(".name").textContent = stop.name;
    if (stop.verified === false) {
      const u = document.createElement("span");
      u.className = "unverified";
      u.textContent = "좌표 미확인";
      li.querySelector(".name").append(u);
    }
    li.querySelector(".sub").textContent = `${stop.time} · ${stop.category} · ${stop.stay_minutes}분`;
    li.addEventListener("click", () => { state.playing = true; goTo(i); });
    list.append(li);
  });
}

// ---------- 투어 ----------
function updatePlayButton() {
  $("play").textContent = state.playing ? "❚❚" : "▶";
  updateAwake();
}

// 자동 투어 중이거나 1인칭 탐색 중일 때만 화면을 켜 둔다
function updateAwake() {
  keepAwake(state.playing || document.body.classList.contains("exploring"));
}

function runProgress(ms) {
  const bar = $("progress-bar");
  bar.style.transition = "none";
  bar.style.width = "0";
  if (!ms) return;
  requestAnimationFrame(() => {
    bar.style.transition = `width ${ms}ms linear`;
    bar.style.width = "100%";
  });
}

function showCard(stop, i) {
  const card = $("card");
  card.hidden = false;
  card.style.animation = "none";
  void card.offsetWidth;
  card.style.animation = "";
  card.style.setProperty("--c", colorOf(stop));
  $("card-index").textContent = `${stop.day}일차 · ${i + 1}/${state.trip.stops.length}`;
  $("card-meta").textContent = `${stop.time} 도착 · ${stop.category} · ${stop.stay_minutes}분 체류`;
  $("card-name").textContent = stop.name;
  $("card-desc").textContent = stop.description;
  $("card-tip").textContent = stop.tip;
  $("card-move").textContent = stop.move_from_prev ? `이동: ${stop.move_from_prev}` : "";
  $("roadview").href = roadviewUrl(stop);
  document.querySelectorAll(".stop").forEach((el) => el.classList.toggle("active", Number(el.dataset.index) === i));
  scrollListTo(document.querySelector(".stop.active"));
}

// 현재 장소가 목록에 보이게. scrollIntoView는 overflow:hidden인 패널(바텀시트)까지 밀어 올리므로 목록만 직접 스크롤
function scrollListTo(el) {
  const list = $("stops");
  if (!el) return;
  const top = el.offsetTop - list.offsetTop;
  if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTo({ top: top - list.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
  }
}

async function goTo(i) {
  const stops = state.trip.stops;
  if (i < 0 || i >= stops.length) return;
  clearTimeout(state.timer);
  const token = ++state.token;
  state.index = i;
  const stop = stops[i];
  const prev = stops[i - 1];
  const heading = prev && prev.day === stop.day ? bearing(prev, stop) : -20;

  showCard(stop, i);
  setClock(stop.time);
  state.renderer.highlight(i);
  runProgress(0);
  document.body.classList.add("touring");
  sheet?.set("collapsed"); // 폰에서는 지도가 보이게 시트를 접는다

  await state.renderer.flyTo(stop, heading);
  if (token !== state.token) return;

  state.renderer.startOrbit();
  if (!state.playing) return;
  runProgress(DWELL_MS);
  state.timer = setTimeout(() => {
    if (token !== state.token) return;
    if (i + 1 < stops.length) goTo(i + 1);
    else finishTour();
  }, DWELL_MS);
}

function finishTour() {
  state.playing = false;
  updatePlayButton();
  runProgress(0);
  state.renderer.highlight(null);
  state.renderer.overview(state.trip.stops);
  setStatus("투어 끝. 목록이나 지도 핀을 눌러 다시 볼 수 있어요.");
}

function pause() {
  state.playing = false;
  state.token++;
  clearTimeout(state.timer);
  runProgress(0);
  updatePlayButton();
}

async function startTrip(trip) {
  await state.mapReady;
  pause();
  state.trip = trip;
  state.index = -1;
  renderList(trip);
  state.renderer.setStops(trip.stops, colorOf, (i) => { state.playing = true; updatePlayButton(); goTo(i); });
  state.renderer.overview(trip.stops);
  setClock(trip.stops[0].time);
  const token = state.token;
  await new Promise((r) => setTimeout(r, 3200));
  if (token !== state.token) return;
  state.playing = true;
  updatePlayButton();
  goTo(0);
}

// ---------- 일정 생성 ----------
async function plan(prompt) {
  if (!state.config.llm) {
    await new Promise((r) => setTimeout(r, 500));
    return { trip: pickPreset(prompt), demo: true };
  }
  const res = await fetch(apiUrl("/api/plan"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { trip: body, demo: false };
}

async function onSubmit(e) {
  e.preventDefault();
  const prompt = $("prompt").value.trim();
  if (!prompt) return $("prompt").focus();
  $("go").disabled = true;
  setStatus(state.config.llm ? "동선을 짜고 좌표를 확인하는 중… (20~40초)" : "샘플 일정을 불러오는 중…", "busy");
  try {
    const { trip, demo } = await plan(prompt);
    setStatus(demo
      ? "데모 모드: Claude 키가 없어 샘플 일정을 보여줘요. (.env에 ANTHROPIC_API_KEY)"
      : `${trip.stops.length}곳, 좌표 확인 ${trip.stops.filter((s) => s.verified).length}곳`);
    await startTrip(trip);
  } catch (err) {
    setStatus(`실패: ${err.message}`, "error");
  } finally {
    $("go").disabled = false;
  }
}

// ---------- 1인칭 탐색 ----------
let explore = null;
let sheet = null;

async function enterStop() {
  const stop = state.trip?.stops[state.index];
  if (!stop) return;
  pause();
  state.renderer.stopOrbit();
  try {
    if (!explore) {
      // three.js·Spark는 처음 들어갈 때만 불러온다
      const { ExploreView } = await import("./explore.js");
      explore = new ExploreView($("explore"));
      explore.onClose = updateAwake;
      $("explore-close").addEventListener("click", () => explore.close());
    }
    const opening = explore.open(stop, sceneFor(stop));
    updateAwake();
    await opening;
  } catch (err) {
    setStatus(`1인칭 보기 실패: ${err.message}`, "error");
  }
}

// ---------- 렌더러 전환 ----------
async function switchMode(mode) {
  if (state.renderer === state.renderers[mode]) return;
  pause();
  document.querySelectorAll("#mode-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  if (!state.renderers[mode]) {
    setStatus("실사 3D 불러오는 중…", "busy");
    try {
      const { CesiumRenderer } = await import("./renderer-cesium.js");
      const r = new CesiumRenderer($("globe"), state.config.googleMapsKey);
      $("globe").hidden = false;
      await r.init();
      r.onUserInteract = pause;
      state.renderers[mode] = r;
      setStatus("");
    } catch (err) {
      setStatus(`실사 3D 실패: ${err.message}`, "error");
      $("globe").hidden = true;
      document.querySelectorAll("#mode-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.mode === "satellite"));
      return;
    }
  }
  state.renderer?.hide();
  state.renderer = state.renderers[mode];
  state.renderer.show();
  if (state.trip) {
    state.renderer.setStops(state.trip.stops, colorOf, (i) => { state.playing = true; updatePlayButton(); goTo(i); });
    if (state.index >= 0) { state.playing = true; updatePlayButton(); goTo(state.index); }
    else state.renderer.overview(state.trip.stops);
  }
}

// ---------- 시작 ----------
async function main() {
  try {
    state.config = await (await fetch(apiUrl("/api/config"))).json();
  } catch { /* 정적 서버로 열었을 때: 데모 모드 */ }

  // 지도 타일을 기다리는 동안에도 입력은 받을 수 있게, 로딩은 기다리지 않고 시작만 해 둔다
  const r = new MapLibreRenderer($("map"));
  r.onUserInteract = pause;
  state.renderers.satellite = state.renderer = r;
  state.mapReady = r.init();

  if (state.config.googleMapsKey) {
    $("mode-toggle").hidden = false;
    $("mode-toggle").addEventListener("click", (e) => {
      const mode = e.target.closest("button")?.dataset.mode;
      if (mode) switchMode(mode);
    });
  }

  for (const text of EXAMPLES) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.addEventListener("click", () => { $("prompt").value = text; $("prompt-form").requestSubmit(); });
    $("examples").append(b);
  }

  $("prompt-form").addEventListener("submit", onSubmit);
  $("prompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("prompt-form").requestSubmit(); }
  });
  sheet = new Sheet($("panel"), [document.querySelector(".sheet-handle"), document.querySelector("#panel .brand")]);
  $("enter").addEventListener("click", enterStop);
  setupNative({
    // 뒤로가기: 1인칭 → 지도. 지도에서는 앱 종료
    onBack: () => {
      if (!document.body.classList.contains("exploring")) return false;
      explore?.close();
      return true;
    },
  });
  $("prev").addEventListener("click", () => goTo(state.index - 1));
  $("next").addEventListener("click", () => goTo(state.index + 1));
  $("play").addEventListener("click", () => {
    if (state.playing) return pause();
    state.playing = true;
    updatePlayButton();
    goTo(state.index + 1 < state.trip.stops.length ? state.index : 0);
  });
  document.addEventListener("keydown", (e) => {
    if (!state.trip || e.target === $("prompt") || document.body.classList.contains("exploring")) return;
    if (e.key === "ArrowRight") goTo(state.index + 1);
    if (e.key === "ArrowLeft") goTo(state.index - 1);
    if (e.key === " ") { e.preventDefault(); $("play").click(); }
  });

  setStatus(state.config.llm ? "" : "데모 모드 (Claude 키 없음): 부산·서울·도쿄 샘플 일정으로 동작해요.");
}

main();

// 키 없이 도는 기본 3D 렌더러: Esri 위성사진 + AWS 지형 + OpenFreeMap(OSM) 3D 건물
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { legCoordinates } from "./legs.js";

const SKY = {
  day:    { sky: "#6fa8e0", horizon: "#d9ecff", fog: "#cfe3f5", brightness: 1.0,  building: "#f1ede6", opacity: 0.82 },
  golden: { sky: "#3b5d8f", horizon: "#ffb36b", fog: "#f3b88a", brightness: 0.82, building: "#ffd9ae", opacity: 0.85 },
  night:  { sky: "#050814", horizon: "#1c2745", fog: "#141b30", brightness: 0.32, building: "#ffcf80", opacity: 0.55 },
};

// 브이월드 타일을 요청할 국내 영역 [서, 남, 동, 북]
const KOREA_BOUNDS = [124.5, 33.0, 131.9, 38.7];

export function phaseOf(hour) {
  if (hour >= 17 && hour < 19.5) return "golden";
  if (hour >= 19.5 || hour < 5.5) return "night";
  return "day";
}

export class MapLibreRenderer {
  // options.vworldKey: 있으면 국내 영역에 브이월드 항공사진·한글 지명을 겹친다
  constructor(container, options = {}) {
    this.container = container;
    this.vworldKey = options.vworldKey ?? null;
    this.markers = [];
    this.orbitFrame = null;
  }

  async init() {
    this.map = new maplibregl.Map({
      container: this.container,
      center: [127.8, 36.3],
      zoom: 6,
      pitch: 45,
      maxPitch: 85,
      // 폰은 devicePixelRatio가 3 안팎이라 그대로 그리면 픽셀이 2배 이상 늘어난다. 2로 제한
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          satellite: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
          },
          terrain: {
            type: "raster-dem",
            tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 14,
            attribution: "Terrain © Mapzen, AWS",
          },
          osm: {
            type: "vector",
            url: "https://tiles.openfreemap.org/planet",
            attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © OpenStreetMap',
          },
          route: { type: "geojson", data: emptyFC() },
        },
        layers: [
          { id: "satellite", type: "raster", source: "satellite", paint: { "raster-brightness-max": 1, "raster-saturation": 0.1 } },
          {
            id: "buildings", type: "fill-extrusion", source: "osm", "source-layer": "building", minzoom: 14,
            paint: {
              "fill-extrusion-color": SKY.day.building,
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": SKY.day.opacity,
              "fill-extrusion-vertical-gradient": true,
            },
          },
          {
            id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ["get", "color"], "line-width": 10, "line-opacity": 0.25, "line-blur": 6 },
          },
          {
            id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
          },
        ],
        sky: {},
        transition: { duration: 1400, delay: 0 },
      },
    });

    await new Promise((resolve) => this.map.once("load", resolve));
    if (this.vworldKey) this.addVworld();
    this.map.setTerrain({ source: "terrain", exaggeration: 1.15 });
    this.setPhase("day");

    // 사용자가 직접 지도를 만지면 자동 회전을 멈춘다
    for (const ev of ["mousedown", "touchstart", "wheel"]) {
      this.map.on(ev, () => {
        this.stopOrbit();
        this.onUserInteract?.();
      });
    }
  }

  show() { this.container.hidden = false; this.map?.resize(); }
  hide() { this.stopOrbit(); this.container.hidden = true; }

  setStops(stops, colorOf, onPick) {
    this.markers.forEach((m) => m.remove());
    this.markers = stops.map((stop, i) => {
      const el = document.createElement("div");
      el.className = "pin";
      el.style.setProperty("--c", colorOf(stop));
      el.innerHTML = `<i>${i + 1}</i><span></span>`;
      el.querySelector("span").textContent = stop.name;
      el.addEventListener("click", (e) => { e.stopPropagation(); onPick(i); });
      return new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -6] })
        .setLngLat([stop.lng, stop.lat])
        .addTo(this.map);
    });

    this.updateRoutes(stops, colorOf);
  }

  // 구간 선. 실제 도로 경로(stop.leg.path)가 있으면 그걸, 없으면 직선
  updateRoutes(stops, colorOf) {
    const legs = [];
    for (let i = 1; i < stops.length; i++) {
      if (stops[i].day !== stops[i - 1].day) continue;
      legs.push({
        type: "Feature",
        properties: { color: colorOf(stops[i]) },
        geometry: { type: "LineString", coordinates: legCoordinates(stops[i - 1], stops[i]) },
      });
    }
    this.map.getSource("route").setData({ type: "FeatureCollection", features: legs });
  }

  highlight(index) {
    this.markers.forEach((m, i) => {
      const el = m.getElement();
      el.classList.toggle("active", i === index);
      el.classList.toggle("dim", index !== null && i !== index);
    });
  }

  overview(stops) {
    this.stopOrbit();
    const b = new maplibregl.LngLatBounds();
    stops.forEach((s) => b.extend([s.lng, s.lat]));
    const panel = window.innerWidth > 760 ? 400 : 0;
    this.map.fitBounds(b, {
      padding: { top: 80, bottom: window.innerWidth > 760 ? 80 : window.innerHeight * 0.5, left: panel + 60, right: 60 },
      pitch: 55, bearing: -15, duration: 2600, maxZoom: 15,
    });
  }

  // 이전 장소에서 날아오는 방향을 바라보며 도착
  flyTo(stop, heading) {
    this.stopOrbit();
    // 진행 중이던 애니메이션이 끊기며 나는 moveend와 구분하려고 이번 비행에 id를 붙인다
    const flightId = (this.flightId = (this.flightId ?? 0) + 1);
    return new Promise((resolve) => {
      const done = (e) => {
        if (e.flightId !== flightId && this.flightId === flightId) return;
        this.map.off("moveend", done);
        resolve();
      };
      this.map.on("moveend", done);
      this.map.flyTo({
        center: [stop.lng, stop.lat],
        zoom: 16.4,
        pitch: 64,
        bearing: heading,
        speed: 0.9,
        curve: 1.6,
        essential: true,
        padding: window.innerWidth > 760 ? { left: 400, bottom: 160 } : { bottom: 0, top: 200 },
      }, { flightId });
    });
  }

  startOrbit(degPerSec = 5) {
    this.stopOrbit();
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      this.map.setBearing(this.map.getBearing() + degPerSec * dt);
      this.orbitFrame = requestAnimationFrame(tick);
    };
    this.orbitFrame = requestAnimationFrame(tick);
  }

  stopOrbit() {
    if (this.orbitFrame) cancelAnimationFrame(this.orbitFrame);
    this.orbitFrame = null;
  }

  // 국토교통부 브이월드 WMTS. Satellite(jpeg, z6~19)는 Esri 위에, Hybrid(png, 한글 지명·도로)는 그 위에.
  // 국내 영역(bounds) 밖은 타일을 요청하지 않아 해외는 Esri 그대로다. 키는 등록 도메인에 묶인 클라이언트 키
  addVworld() {
    const tiles = (layer, ext) => [`https://api.vworld.kr/req/wmts/1.0.0/${this.vworldKey}/${layer}/{z}/{y}/{x}.${ext}`];
    const common = { type: "raster", tileSize: 256, minzoom: 6, maxzoom: 19, bounds: KOREA_BOUNDS };
    this.map.addSource("vworld-satellite", { ...common, tiles: tiles("Satellite", "jpeg"), attribution: "항공사진 © 국토교통부 브이월드" });
    this.map.addSource("vworld-hybrid", { ...common, tiles: tiles("Hybrid", "png") });
    this.map.addLayer({ id: "vworld-satellite", type: "raster", source: "vworld-satellite", paint: { "raster-brightness-max": 1 } }, "buildings");
    this.map.addLayer({ id: "vworld-hybrid", type: "raster", source: "vworld-hybrid", minzoom: 10, paint: { "raster-opacity": 0.9 } }, "buildings");

    // 키가 틀리거나 도메인이 등록되지 않으면 브이월드는 HTTP 200 + XML 오류 본문을 준다.
    // 타일만 조용히 빠지고 Esri가 비쳐 보이므로, 원인을 알 수 있게 한 번만 경고한다
    let warned = false;
    this.map.on("error", (e) => {
      if (warned || !e.sourceId?.startsWith("vworld")) return;
      warned = true;
      console.warn("[브이월드] 타일을 불러오지 못했어요. VWORLD_KEY와 등록한 서비스 URL(도메인)을 확인하세요.", e.error?.message ?? "");
    });
  }

  setPhase(phase) {
    const s = SKY[phase];
    this.map.setSky({
      "sky-color": s.sky,
      "horizon-color": s.horizon,
      "fog-color": s.fog,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0],
    });
    this.map.setPaintProperty("satellite", "raster-brightness-max", s.brightness);
    if (this.vworldKey) {
      this.map.setPaintProperty("vworld-satellite", "raster-brightness-max", s.brightness);
      // 밤에도 지명은 읽히게 사진보다 덜 어둡게
      this.map.setPaintProperty("vworld-hybrid", "raster-brightness-max", Math.max(s.brightness, 0.7));
    }
    this.map.setPaintProperty("buildings", "fill-extrusion-color", s.building);
    this.map.setPaintProperty("buildings", "fill-extrusion-opacity", s.opacity);
  }
}

function emptyFC() {
  return { type: "FeatureCollection", features: [] };
}

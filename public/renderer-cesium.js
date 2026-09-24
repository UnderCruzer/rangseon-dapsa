// Google Photorealistic 3D Tiles 렌더러. GOOGLE_MAPS_API_KEY가 있을 때만 켜진다.
// (Map Tiles API를 켠 키 필요. 국내는 커버리지가 제한적일 수 있음)
const CESIUM = "https://cdn.jsdelivr.net/npm/cesium@1.145.0/Build/Cesium";

function loadCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  window.CESIUM_BASE_URL = CESIUM;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = `${CESIUM}/Widgets/widgets.css`;
  document.head.append(css);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${CESIUM}/Cesium.js`;
    s.onload = () => resolve(window.Cesium);
    s.onerror = () => reject(new Error("Cesium 로드 실패"));
    document.head.append(s);
  });
}

const BRIGHTNESS = { day: 1.0, golden: 0.85, night: 0.4 };
const RANGE = 520;        // 카메라와 장소 사이 거리(m)
const PITCH = -26;        // 내려다보는 각도

export class CesiumRenderer {
  constructor(container, apiKey) {
    this.container = container;
    this.apiKey = apiKey;
    this.entities = [];
    this.removeOrbit = null;
  }

  async init() {
    const Cesium = (this.C = await loadCesium());
    Cesium.GoogleMaps.defaultApiKey = this.apiKey;
    this.viewer = new Cesium.Viewer(this.container, {
      globe: false,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      animation: false,
      timeline: false,
      infoBox: false,
      selectionIndicator: false,
    });
    this.viewer.scene.skyAtmosphere.show = true;
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true });
    this.viewer.scene.primitives.add(tileset);

    this.brightness = this.viewer.scene.postProcessStages.add(Cesium.PostProcessStageLibrary.createBrightnessStage());
    this.brightness.uniforms.brightness = 1;

    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    for (const t of [Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.ScreenSpaceEventType.WHEEL]) {
      handler.setInputAction(() => { this.stopOrbit(); this.onUserInteract?.(); }, t);
    }
    handler.setInputAction((e) => {
      const picked = this.viewer.scene.pick(e.position);
      const idx = picked?.id?.stopIndex;
      if (idx !== undefined) this.onPick?.(idx);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  show() { this.container.hidden = false; }
  hide() { this.stopOrbit(); this.container.hidden = true; }

  setStops(stops, colorOf, onPick) {
    const C = this.C;
    this.onPick = onPick;
    this.entities.forEach((e) => this.viewer.entities.remove(e));
    this.entities = stops.map((s, i) => {
      const color = C.Color.fromCssColorString(colorOf(s));
      const e = this.viewer.entities.add({
        position: C.Cartesian3.fromDegrees(s.lng, s.lat, 70),
        point: { pixelSize: 14, color, outlineColor: C.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Infinity },
        label: {
          text: `${i + 1}. ${s.name}`,
          font: "600 13px Pretendard, sans-serif",
          fillColor: C.Color.WHITE,
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString("rgba(12,14,20,.82)"),
          pixelOffset: new C.Cartesian2(0, -22),
          disableDepthTestDistance: Infinity,
        },
      });
      e.stopIndex = i;
      return e;
    });
    for (let i = 1; i < stops.length; i++) {
      if (stops[i].day !== stops[i - 1].day) continue;
      this.entities.push(this.viewer.entities.add({
        polyline: {
          positions: C.Cartesian3.fromDegreesArrayHeights([stops[i - 1].lng, stops[i - 1].lat, 90, stops[i].lng, stops[i].lat, 90]),
          width: 3,
          material: new C.PolylineDashMaterialProperty({ color: C.Color.fromCssColorString(colorOf(stops[i])) }),
        },
      }));
    }
  }

  highlight() {}

  overview(stops) {
    const C = this.C;
    this.stopOrbit();
    const pts = stops.map((s) => C.Cartesian3.fromDegrees(s.lng, s.lat, 0));
    const sphere = C.BoundingSphere.fromPoints(pts);
    this.viewer.camera.flyToBoundingSphere(sphere, {
      offset: new C.HeadingPitchRange(C.Math.toRadians(-15), C.Math.toRadians(-40), Math.max(sphere.radius * 3, 2500)),
      duration: 2.5,
    });
  }

  flyTo(stop, heading) {
    const C = this.C;
    this.stopOrbit();
    const center = C.Cartesian3.fromDegrees(stop.lng, stop.lat, 40);
    this.heading = C.Math.toRadians(heading);
    return new Promise((resolve) => {
      this.viewer.camera.flyToBoundingSphere(new C.BoundingSphere(center, 1), {
        offset: new C.HeadingPitchRange(this.heading, C.Math.toRadians(PITCH), RANGE),
        duration: 3.8,
        complete: resolve,
        cancel: resolve,
      });
      this.center = center;
    });
  }

  startOrbit(degPerSec = 5) {
    const C = this.C;
    this.stopOrbit();
    let last = performance.now();
    this.removeOrbit = this.viewer.clock.onTick.addEventListener(() => {
      const now = performance.now();
      this.heading += C.Math.toRadians(degPerSec * ((now - last) / 1000));
      last = now;
      this.viewer.camera.lookAt(this.center, new C.HeadingPitchRange(this.heading, C.Math.toRadians(PITCH), RANGE));
    });
  }

  stopOrbit() {
    if (!this.removeOrbit) return;
    this.removeOrbit();
    this.removeOrbit = null;
    this.viewer.camera.lookAtTransform(this.C.Matrix4.IDENTITY);
  }

  setPhase(phase) {
    if (this.brightness) this.brightness.uniforms.brightness = BRIGHTNESS[phase];
  }
}

// Frame export for world-model control inputs. Loaded only with ?export=1.
// Renders a fixed camera path over the real PLATEAU scene and returns, per frame,
// the RGB render and a depth image computed from the actual 3D geometry.

// Presentation camera paths, not measured or ground-level verified trajectories.
export const PATHS = {
  'tower-orbit': {
    center: {lng: 139.74544, lat: 35.6585639, height: 150},
    heading: [-60, -20], pitch: [-18, -18], range: [720, 720], depth: [300, 4000],
  },
  'tower-approach': {
    center: {lng: 139.74544, lat: 35.6585639, height: 120},
    heading: [-35, -35], pitch: [-30, -14], range: [1500, 650], depth: [150, 4000],
  },
  // Eye level along the Day 1 OSM walking leg Azabudai Hills → Tokyo Tower (distances along
  // the leg, meters). Height follows the PLATEAU road surface or terrain, buildings excluded.
  'tower-walk': {
    walk: {leg: 3, from: 700, to: 715, eye: 1.6, lookAhead: 20, pitch: 6}, fov: 75, depth: [3, 1500],
  },
};

// depth: [near, far] meters. Inverse view-axis depth normalized to 1 at near, 0 at far or sky
// (near-bright, like monocular depth estimators). Closer geometry saturates; reported per frame.

// Cesium stores log depth: d = log2(z - near + 1) / log2(far - near + 1), z = view-axis eye depth.
const depthShader = (near, far) => `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
in vec2 v_textureCoordinates;
void main() {
  float d = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
  if (d <= 0.0 || d >= 1.0) { out_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float z = exp2(d * czm_log2FarDepthFromNearPlusOne) - 1.0 + czm_currentFrustum.x;
  float v = clamp((1.0 / z - 1.0 / ${far.toFixed(1)}) / (1.0 / ${near.toFixed(1)} - 1.0 / ${far.toFixed(1)}), 0.0, 1.0);
  out_FragColor = vec4(vec3(v), 1.0);
}`;

const lerp = (a, b, t) => a + (b - a) * t;
const EARTH_R = 6371008.8;

function pointAlong(C, coords, s) {
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const [a, b] = coords[i - 1], [x, y] = coords[i];
    const d = Math.hypot(C.Math.toRadians(x - a) * Math.cos(C.Math.toRadians(b)) * EARTH_R, C.Math.toRadians(y - b) * EARTH_R);
    if (acc + d >= s) { const f = (s - acc) / d; return [a + (x - a) * f, b + (y - b) * f]; }
    acc += d;
  }
  return coords.at(-1);
}

export function install({viewer, C, tilesets, trip}) {
  const depthStages = Object.fromEntries(Object.entries(PATHS).map(([name, p]) => {
    const stage = viewer.scene.postProcessStages.add(new C.PostProcessStage({fragmentShader: depthShader(...p.depth)}));
    stage.enabled = false;
    return [name, stage];
  }));
  document.body.classList.add('exporting');
  // Interactive loading shortcuts defer or skip tile requests without counting them in
  // tilesLoaded, so a frame could be captured half-loaded. Exports load the full selection.
  for (const set of tilesets) {
    set.cullRequestsWhileMoving = false;
    set.foveatedScreenSpaceError = false;
    set.dynamicScreenSpaceError = false;
    set.progressiveResolutionHeightFraction = 0;
    set.skipLevelOfDetail = false;
    // The interactive memory budget lowers detail on wide views; offline export can afford more.
    set.cacheBytes = 1024 * 1024 * 1024;
    set.maximumCacheOverflowBytes = 1024 * 1024 * 1024;
  }
  viewer.resolutionScale = 1;
  // The viewer keeps users 35 m off the ground; eye-level paths need the camera where placed.
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
  viewer.scene.fog.enabled = false; // fog would alter the RGB the depth is paired with

  const rendered = () => new Promise((resolve) => {
    const remove = viewer.scene.postRender.addEventListener(() => { remove(); resolve(); });
    viewer.scene.requestRender();
  });

  // tilesLoaded can read true for a moment right after a camera jump, before new tiles are
  // requested. Require it to hold over consecutive renders.
  async function settle(timeoutMs, stableRenders = 8) {
    const start = performance.now();
    let stable = 0;
    while (performance.now() - start < timeoutMs) {
      await rendered();
      const loaded = viewer.scene.globe.tilesLoaded && tilesets.every((set) => set.tilesLoaded);
      stable = loaded ? stable + 1 : 0;
      if (stable >= stableRenders) return true;
      await new Promise((r) => setTimeout(r, 60));
    }
    return false;
  }

  // Ground under the walk, sampled once per path on a fine grid and smoothed so tile seams
  // in the road surface do not make the camera bob.
  const grounds = {};
  async function walkGround(path) {
    if (grounds[path]) return grounds[path];
    const w = PATHS[path].walk;
    const coords = trip.legs[w.leg].geometry.coordinates;
    const n = 121, end = w.to + w.lookAhead;
    const pts = Array.from({length: n}, (_, i) => pointAlong(C, coords, lerp(w.from, end, i / (n - 1))));
    const cartos = pts.map(([lng, lat]) => C.Cartographic.fromDegrees(lng, lat));
    const terrain = await C.sampleTerrainMostDetailed(viewer.terrainProvider, cartos.map((c) => c.clone()));
    const surface = await viewer.scene.sampleHeightMostDetailed(cartos.map((c) => c.clone()), [tilesets[0]]);
    // Road surface counts only when it sits on the terrain; higher hits are overhead structures
    // such as elevated expressways, which the walker passes under.
    const raw = terrain.map((c, i) => {
      const s = surface[i]?.height;
      return s !== undefined && s - c.height < 3 ? Math.max(c.height, s) : c.height;
    });
    const smooth = raw.map((_, i) => {
      const window = raw.slice(Math.max(0, i - 6), i + 7).sort((a, b) => a - b);
      return window[Math.floor(window.length / 2)];
    });
    grounds[path] = {coords, end, n, smooth, height: (s) => {
      const x = (s - w.from) / (end - w.from) * (n - 1), i = Math.min(n - 2, Math.max(0, Math.floor(x)));
      return lerp(smooth[i], smooth[i + 1], x - i);
    }};
    return grounds[path];
  }

  async function place(path, t) {
    const p = PATHS[path];
    viewer.camera.frustum.fov = C.Math.toRadians(p.fov ?? 60);
    if (p.walk) {
      const w = p.walk, g = await walkGround(path);
      const s = lerp(w.from, w.to, t);
      const [lng, lat] = pointAlong(C, g.coords, s), [tlng, tlat] = pointAlong(C, g.coords, s + w.lookAhead);
      const eyeH = g.height(s) + w.eye;
      const pos = C.Cartesian3.fromDegrees(lng, lat, eyeH);
      const target = C.Cartesian3.fromDegrees(tlng, tlat, g.height(s + w.lookAhead) + w.eye + Math.tan(C.Math.toRadians(w.pitch)) * w.lookAhead);
      const direction = C.Cartesian3.normalize(C.Cartesian3.subtract(target, pos, new C.Cartesian3()), new C.Cartesian3());
      const normal = C.Ellipsoid.WGS84.geodeticSurfaceNormal(pos, new C.Cartesian3());
      const right = C.Cartesian3.normalize(C.Cartesian3.cross(direction, normal, new C.Cartesian3()), new C.Cartesian3());
      const up = C.Cartesian3.cross(right, direction, new C.Cartesian3());
      viewer.camera.setView({destination: pos, orientation: {direction, up}});
      return;
    }
    const center = C.Cartesian3.fromDegrees(p.center.lng, p.center.lat, p.center.height);
    const hpr = new C.HeadingPitchRange(
      C.Math.toRadians(lerp(...p.heading, t)), C.Math.toRadians(lerp(...p.pitch, t)), lerp(...p.range, t));
    viewer.camera.lookAt(center, hpr);
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  }

  // Compare the decoded depth image with Cesium's own pickPosition on a 5x5 grid.
  function validate(depthCanvas, [near, far]) {
    const ctx = depthCanvas.getContext('2d', {willReadFrequently: true});
    const errors = [];
    for (let gy = 1; gy <= 5; gy++) for (let gx = 1; gx <= 5; gx++) {
      const x = Math.floor(gx / 6 * depthCanvas.width), y = Math.floor(gy / 6 * depthCanvas.height);
      const pos = viewer.scene.pickPosition(new C.Cartesian2(x, y));
      const v = ctx.getImageData(x, y, 1, 1).data[0] / 255;
      if (!pos || v === 0) continue;
      const truth = C.Cartesian3.dot(C.Cartesian3.subtract(pos, viewer.camera.positionWC, new C.Cartesian3()), viewer.camera.directionWC);
      if (v === 1) continue; // saturated, counted separately
      const decoded = 1 / (v * (1 / near - 1 / far) + 1 / far);
      errors.push(Math.abs(decoded - truth) / truth);
    }
    const all = ctx.getImageData(0, 0, depthCanvas.width, depthCanvas.height).data;
    let saturated = 0;
    for (let i = 0; i < all.length; i += 4) if (all[i] === 255) saturated++;
    errors.sort((a, b) => a - b);
    return {saturated_fraction: saturated / (all.length / 4), samples: errors.length, median_rel_error: errors[Math.floor(errors.length / 2)] ?? null, max_rel_error: errors.at(-1) ?? null};
  }

  window.__exportApi = {
    paths: Object.keys(PATHS),
    async frame(path, t, check = false, timeoutMs = 90000) {
      if (!PATHS[path]) throw new Error(`Unknown path ${path}`);
      await place(path, t);
      const complete = await settle(timeoutMs);
      const canvas = viewer.scene.canvas;
      const rgb = canvas.toDataURL('image/png');
      const depthStage = depthStages[path];
      depthStage.enabled = true;
      await rendered();
      const depth = canvas.toDataURL('image/png');
      let depthCheck = null;
      if (check) {
        const copy = document.createElement('canvas');
        copy.width = canvas.width; copy.height = canvas.height;
        copy.getContext('2d').drawImage(canvas, 0, 0);
        depthCheck = validate(copy, PATHS[path].depth);
      }
      depthStage.enabled = false;
      return {
        rgb, depth, tiles_complete: complete, depth_check: depthCheck,
        viewport: {width: canvas.width, height: canvas.height},
        camera: {
          position: C.Cartesian3.pack(viewer.camera.positionWC,[]),
          direction: C.Cartesian3.pack(viewer.camera.directionWC,[]),
          up: C.Cartesian3.pack(viewer.camera.upWC,[]),
          fovy_deg: C.Math.toDegrees(viewer.camera.frustum.fovy),
        },
      };
    },
  };
}

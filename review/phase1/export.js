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
    heading: [-35, -35], pitch: [-30, -14], range: [1500, 650], depth: [300, 4000],
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

export function install({viewer, C, tilesets}) {
  const depthStages = Object.fromEntries(Object.entries(PATHS).map(([name, p]) => {
    const stage = viewer.scene.postProcessStages.add(new C.PostProcessStage({fragmentShader: depthShader(...p.depth)}));
    stage.enabled = false;
    return [name, stage];
  }));
  document.body.classList.add('exporting');
  viewer.resolutionScale = 1;
  viewer.scene.fog.enabled = false; // fog would alter the RGB the depth is paired with

  const rendered = () => new Promise((resolve) => {
    const remove = viewer.scene.postRender.addEventListener(() => { remove(); resolve(); });
    viewer.scene.requestRender();
  });

  async function settle(timeoutMs) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      await rendered();
      if (viewer.scene.globe.tilesLoaded && tilesets.every((set) => set.tilesLoaded)) {
        await rendered();
        return true;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  function place(path, t) {
    const p = PATHS[path];
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
      place(path, t);
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

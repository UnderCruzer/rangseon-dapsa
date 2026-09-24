// 장소 안을 1인칭으로 걸어보는 Gaussian Splatting 뷰어 (Spark + three.js)
import * as THREE from "three";
import { SparkRenderer, SplatMesh, SparkControls } from "@sparkjsdev/spark";

const $ = (id) => document.getElementById(id);

export class ExploreView {
  constructor(root) {
    this.root = root;
    this.stage = root.querySelector(".explore-stage");
    this.splat = null;
    this.loadId = 0;
    this.onClose = null;
  }

  // 렌더러·컨트롤은 처음 열 때 한 번만 만들고 재사용한다 (SparkControls는 해제 API가 없음)
  setup() {
    if (this.renderer) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.stage.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0b0d12");
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000);
    this.scene.add(new SparkRenderer({ renderer: this.renderer }));

    this.controls = new SparkControls({ canvas: this.renderer.domElement });
    this.controls.fpsMovement.moveSpeed = 1.2;

    this.resize = () => {
      const { clientWidth: w, clientHeight: h } = this.stage;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", this.resize);

    this.onKey = (e) => {
      if (e.key === "Escape") this.close();
    };
  }

  async open(stop, scene) {
    this.setup();
    this.root.hidden = false;
    document.body.classList.add("exploring");
    this.resize();

    $("explore-name").textContent = stop.name;
    $("explore-source").textContent = scene.sample
      ? `샘플 장면 · 실제 ${stop.name} 아님 · ${scene.credit}`
      : `AI 생성 장면 · 사진 밖 영역은 모델이 채운 것`;
    $("explore-source").classList.toggle("sample", scene.sample);
    this.setLoading(0);

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.setControls(true);
    window.addEventListener("keydown", this.onKey);
    this.renderer.setAnimationLoop(() => {
      this.controls.update(this.camera);
      this.renderer.render(this.scene, this.camera);
    });

    this.disposeSplat();
    const loadId = ++this.loadId;
    const splat = new SplatMesh({
      url: scene.url,
      onProgress: (e) => {
        if (loadId === this.loadId && e.lengthComputable) this.setLoading(e.loaded / e.total);
      },
    });
    splat.quaternion.set(1, 0, 0, 0); // 대부분의 3DGS 결과물은 y축이 뒤집혀 있음
    this.splat = splat;
    this.scene.add(splat);

    try {
      await splat.initialized;
      if (loadId === this.loadId) this.setLoading(null);
    } catch (err) {
      if (loadId === this.loadId) this.setLoading(null, `장면을 불러오지 못했어요: ${err.message}`);
    }
  }

  close() {
    if (this.root.hidden) return;
    this.loadId++;
    this.root.hidden = true;
    document.body.classList.remove("exploring");
    window.removeEventListener("keydown", this.onKey);
    this.setControls(false);
    this.renderer.setAnimationLoop(null);
    this.disposeSplat();
    this.onClose?.();
  }

  setControls(on) {
    this.controls.fpsMovement.enable = on;
    this.controls.pointerControls.enable = on;
  }

  disposeSplat() {
    if (!this.splat) return;
    this.scene.remove(this.splat);
    this.splat.dispose();
    this.splat = null;
  }

  setLoading(progress, error) {
    const box = $("explore-loading");
    box.hidden = progress === null && !error;
    box.classList.toggle("error", Boolean(error));
    $("explore-loading-text").textContent = error ?? (progress ? `장면 불러오는 중 ${Math.round(progress * 100)}%` : "장면 불러오는 중…");
  }
}

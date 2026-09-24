// 장소 안을 1인칭으로 걸어보는 Gaussian Splatting 뷰어 (Spark + three.js)
import * as THREE from "three";
import { SparkRenderer, SplatMesh, SparkControls } from "@sparkjsdev/spark";

const $ = (id) => document.getElementById(id);
const WALK_SPEED = 1.6; // 장면 단위/초
const UP = new THREE.Vector3(0, 1, 0);
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

// 화면 왼쪽 아래 가상 조이스틱. value는 -1~1 (y는 위로 밀면 음수)
class Joystick {
  constructor(el) {
    this.el = el;
    this.value = { x: 0, y: 0 };
    this.pointerId = null;
    const radius = () => el.clientWidth / 2;

    const move = (e) => {
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const max = radius() - 12;
      const len = Math.hypot(dx, dy);
      if (len > max) { dx *= max / len; dy *= max / len; }
      el.style.setProperty("--jx", `${dx}px`);
      el.style.setProperty("--jy", `${dy}px`);
      this.value = { x: dx / max, y: dy / max };
    };
    const end = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      el.classList.remove("active");
      el.style.setProperty("--jx", "0px");
      el.style.setProperty("--jy", "0px");
      this.value = { x: 0, y: 0 };
    };

    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      el.classList.add("active");
      move(e);
    });
    el.addEventListener("pointermove", (e) => { if (e.pointerId === this.pointerId) move(e); });
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  reset() {
    this.value = { x: 0, y: 0 };
    this.el.style.setProperty("--jx", "0px");
    this.el.style.setProperty("--jy", "0px");
  }
}

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
    // 스플랫은 픽셀당 비용이 커서 터치 기기(대부분 폰)는 1.5로 더 낮춘다
    const touch = window.matchMedia("(hover: none)").matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, touch ? 1.5 : 2));
    this.stage.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0b0d12");
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000);
    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);

    this.controls = new SparkControls({ canvas: this.renderer.domElement });
    this.controls.fpsMovement.moveSpeed = 1.2;

    this.resize = () => {
      const { clientWidth: w, clientHeight: h } = this.stage;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", this.resize);

    this.joystick = new Joystick($("joystick"));

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
    this.setLoading("장면 불러오는 중…");

    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.setControls(true);
    window.addEventListener("keydown", this.onKey);
    let last = performance.now();
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      this.controls.update(this.camera);
      this.walk(dt);
      this.renderer.render(this.scene, this.camera);
      // 파일 로드(initialized)가 끝나도 GPU 업로드·첫 정렬 전에는 화면이 비어 있다. 실제로 그려질 때 로딩 표시를 내린다
      if (this.waitingFirstFrame && this.spark.activeSplats > 0 && this.spark.lastSortTime > 0) {
        this.waitingFirstFrame = false;
        this.setLoading(null);
      }
    });

    this.disposeSplat();
    const loadId = ++this.loadId;
    const splat = new SplatMesh({
      url: scene.url,
      onProgress: (e) => {
        if (loadId === this.loadId && e.lengthComputable) {
          this.setLoading(`장면 불러오는 중 ${Math.round((e.loaded / e.total) * 100)}%`);
        }
      },
    });
    splat.quaternion.set(1, 0, 0, 0); // 대부분의 3DGS 결과물은 y축이 뒤집혀 있음
    splat.position.fromArray(scene.position ?? [0, 0, 0]);
    this.splat = splat;
    this.scene.add(splat);

    try {
      await splat.initialized;
      if (loadId !== this.loadId) return;
      this.waitingFirstFrame = true;
      this.setLoading("장면 그리는 중…");
    } catch (err) {
      if (loadId === this.loadId) this.setLoading(`장면을 불러오지 못했어요: ${err.message}`, true);
    }
  }

  close() {
    if (this.root.hidden) return;
    this.loadId++;
    this.waitingFirstFrame = false;
    this.root.hidden = true;
    document.body.classList.remove("exploring");
    window.removeEventListener("keydown", this.onKey);
    this.setControls(false);
    this.joystick.reset();
    this.renderer.setAnimationLoop(null);
    this.disposeSplat();
    this.onClose?.();
  }

  // 조이스틱 입력을 수평 이동으로: 아래를 보고 있어도 땅속으로 파고들지 않게 고개 방향(yaw)만 쓴다
  walk(dt) {
    const { x, y } = this.joystick.value;
    if (!x && !y) return;
    const forward = this.camera.getWorldDirection(_forward).setY(0).normalize();
    const right = _right.crossVectors(forward, UP);
    this.camera.position
      .addScaledVector(forward, -y * WALK_SPEED * dt)
      .addScaledVector(right, x * WALK_SPEED * dt);
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

  // text가 null이면 숨김
  setLoading(text, isError = false) {
    const box = $("explore-loading");
    box.hidden = text === null;
    box.classList.toggle("error", isError);
    if (text !== null) $("explore-loading-text").textContent = text;
  }
}

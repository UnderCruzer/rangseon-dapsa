// 좁은 화면에서 일정 패널을 바텀시트로: 접힘 / 중간 / 펼침 3단계 스냅.
// 손잡이와 머리글을 끌어서 높이를 바꾸고, 짧게 탭하면 접힘 ↔ 중간을 오간다.
const MOBILE = window.matchMedia("(max-width: 760px)");
const TAP_PX = 6;

// CSS 변수에 든 safe-area 값(env()·var() 식)을 실제 px로: 높이로 걸어서 재 본다
function insetPx(name) {
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;visibility:hidden;height:var(${name})`;
  document.body.append(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

export class Sheet {
  constructor(panel, grips) {
    this.panel = panel;
    this.state = "half";
    this.apply();

    for (const grip of grips) {
      grip.addEventListener("pointerdown", (e) => this.start(e, grip));
    }
    MOBILE.addEventListener("change", () => this.apply());
    window.addEventListener("resize", () => this.apply());
  }

  // 상태별 높이(px). 안전 영역은 CSS 변수에서 읽는다
  heights() {
    const vh = window.innerHeight;
    const sab = insetPx("--sab");
    const sat = insetPx("--sat");
    return {
      collapsed: 92 + sab,
      half: Math.round(vh * 0.48),
      full: Math.round(vh - sat - 72),
    };
  }

  set(state) {
    this.state = state;
    this.apply();
  }

  apply(px) {
    if (!MOBILE.matches) {
      this.panel.style.removeProperty("height");
      delete this.panel.dataset.sheet;
      return;
    }
    this.panel.dataset.sheet = this.state;
    this.panel.style.height = `${px ?? this.heights()[this.state]}px`;
  }

  start(e, grip) {
    if (!MOBILE.matches || e.button > 0) return;
    // 입력창·버튼을 누른 건 시트 조작이 아님
    if (e.target.closest("textarea, input, button, a")) return;
    const startY = e.clientY;
    const startH = this.panel.getBoundingClientRect().height;
    const { collapsed, full } = this.heights();
    let moved = false;

    grip.setPointerCapture(e.pointerId);
    this.panel.classList.add("dragging");

    const move = (ev) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > TAP_PX) moved = true;
      if (moved) this.apply(Math.min(full, Math.max(collapsed, startH - dy)));
    };
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      this.panel.classList.remove("dragging");
      if (!moved) return this.set(this.state === "collapsed" ? "half" : "collapsed");
      // 가장 가까운 단계로 스냅
      const h = this.panel.getBoundingClientRect().height;
      const [nearest] = Object.entries(this.heights()).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0];
      this.set(nearest);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }
}

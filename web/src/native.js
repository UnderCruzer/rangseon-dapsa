// Capacitor 앱에서만 켜지는 기기 연동. 웹에서는 아무것도 하지 않는다.
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { KeepAwake } from "@capacitor-community/keep-awake";

export const isNative = Capacitor.isNativePlatform();

// onBack이 true를 돌려주면 앱 안에서 처리한 것, 아니면 앱을 닫는다
export function setupNative({ onBack }) {
  if (!isNative) return;

  App.addListener("backButton", () => {
    if (!onBack()) App.exitApp();
  });

  // 거리뷰 같은 외부 링크는 WebView 안이 아니라 시스템 브라우저로
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[target="_blank"]');
    if (!a?.href) return;
    e.preventDefault();
    Browser.open({ url: a.href });
  });
}

// 투어·1인칭 중에는 화면이 꺼지지 않게. 앱은 플러그인, 웹은 Screen Wake Lock API
let wakeLock = null;
let awake = false;

export async function keepAwake(on) {
  if (on === awake) return;
  awake = on;
  try {
    if (isNative) {
      await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep());
    } else if ("wakeLock" in navigator) {
      if (on) wakeLock = await navigator.wakeLock.request("screen");
      else await wakeLock?.release();
    }
  } catch {
    // 지원 안 하는 브라우저·권한 거부는 무시: 화면 꺼짐 방지는 편의 기능
  }
}

// 탭을 떠났다 돌아오면 웹 wake lock은 풀려 있으므로 다시 건다
document.addEventListener("visibilitychange", () => {
  if (!isNative && awake && document.visibilityState === "visible") {
    awake = false;
    keepAwake(true);
  }
});

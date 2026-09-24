// Capacitor 앱에서만 켜지는 기기 연동. 웹에서는 아무것도 하지 않는다.
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

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

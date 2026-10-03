# Phase 1 — 실제 도쿄 3D 기술 실증 (#24)

방향: [REALWORLD.md](../phase0/REALWORLD.md). 점토·Higgsfield 스타일 프레임(#23)은 사용자 지시("너무 게임 같다")로 철회했다.

## 확인 완료

- **검토 뷰어** `review/phase1/` — Cesium 1.145, PLATEAU 미나토구 2025 건물 LOD3(텍스처)·도로 LOD3, PLATEAU 지형, 国土地理院 seamlessphoto 항공사진. 주변 조감·타워 근접·도로 근접 3시점, Day 1 OSM 도보선 토글, 객체 클릭 시 원본 속성 표시.
  - 2026-10-03 데스크톱 브라우저 확인: 타일 로드, 콘솔 오류 없음, 도쿄타워 객체 선택 시 `bldg:measuredHeight` 332.1m 표시.
  - 도로 GLB 샘플에 텍스처가 없어 중성 회색으로 표시한다. 측정된 표면색이 아니다.
  - 모바일 폭 레이아웃은 확인했으나 3D 렌더는 숨겨진 패널(`document.hidden`)이라 미확인. 실기기 확인 필요.
- **원본 타일 샘플** `data/phase1/` — 건물 `data248.b3dm`(101개 객체), 도로 `data898.b3dm`(17개 객체)를 받아 SHA-256·수집시각 기록. `verify_sources.py`가 네트워크 없이 해시를 검사하고 `verified-features.json`을 재생성한다. 최고 높이 객체 332.1m(도쿄타워로 추정; `gml:name` 비어 있음).
- **월드모델 입력 후보** — 뷰어의 "비교 장면 저장"이 RGB 렌더·Sobel 윤곽·카메라(ECEF)·출처를 JSON 하나로 저장. `unpack_reference.py`가 PNG 2장 + manifest로 분리하고 해시를 남긴다(합성 입력으로 동작 확인).

## 미완료 — 월드모델 실행

**월드모델은 실행하지 않았다.** 후보 NVIDIA Cosmos Transfer는 NVIDIA GPU(CUDA)가 필요하다. 이 작업 환경은 Apple M5(Metal)라 로컬 실행이 불가능하다. 실행하려면 다음 중 하나를 사용자가 결정해야 한다.

1. 클라우드 GPU 대여 (유료, 사용자 계정)
2. 호스팅 추론 API (API 키 필요, 사용 조건 확인)

또한 현재 저장 형식은 **단일 프레임**이다. Transfer는 영상 조건 입력이므로 고정 카메라 경로를 따라 연속 프레임(RGB·edge·depth)을 뽑는 기능이 추가로 필요하다. depth는 아직 내보내지 않는다.

## 재현

```sh
python3 -B scripts/phase1/verify_sources.py          # 오프라인 해시 검사·재생성
python3 -B scripts/phase1/verify_sources.py --fetch  # 원본 재수집 (다른 관측 버전일 수 있음)
python3 -B scripts/phase1/serve.py                   # http://127.0.0.1:8792/review/phase1/
python3 -B scripts/phase1/unpack_reference.py tokyo-reference-*.json out/
```

PLATEAU 이용조건: https://www.mlit.go.jp/plateau/site-policy/ (데이터셋 라이선스 표기 「３．著作権について」).

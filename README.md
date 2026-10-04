# 랑선답사

**한 줄로 떠나는 국내 여행 사전 답사.**
"부산 당일치기, 바다 위주로" 한 줄이면 실제로 다닐 수 있는 동선을 짜고, 3D 지도 위에서 그 동선을 미리 날아가 보고, 도착한 장소를 눈높이로 걸어 본다. 건물·길의 위치는 실제 공간 데이터로 고정하고, 겉모습은 월드모델로 실사화한다.

> 작업 규칙과 설계 원칙은 [AGENTS.md](AGENTS.md)를 먼저 읽는다. 통합 브랜치는 `develop`이며 PR은 모두 `develop`으로 보낸다.

## 왜 국내 여행인가

여행 전에 정말 궁금한 건 "가 보면 어떤가"다. 이 동선이 하루에 되는지, 도착하면 눈앞에 뭐가 보이는지, 그 시간에 가면 어떤지.

- **AI 일정 앱**은 많지만 결과는 목록과 2D 지도다. 가 보기 전의 감각은 주지 않는다.
- **Google 지도**는 Immersive View로 경로를 3D로 미리 보여 주고, 2026년에는 Gemini 기반 여행 계획(Ask Maps)까지 붙였다. 하지만 이 3D 경험은 해외 중심이다.
- 국내는 2026년 2월 Google의 1:5000 정밀지도 반출이 조건부로 허가되어 길찾기가 단계적으로 들어오지만, **3차원 정보는 반출 대상에서 제외**됐다. 국내 장소를 3D로 미리 걸어 보는 경험은 당분간 빈자리다.

랑선답사는 그 빈자리를 국내 데이터로 채운다.

## 유사 서비스와 비교

| | Google 지도 | AI 일정 앱 | 스플랫 가상 투어 | **랑선답사** |
|---|---|---|---|---|
| 한 줄로 일정 생성 | O (Ask Maps) | O | X | O |
| 동선 전체 3D 미리보기 | O (해외 중심) | X | X | O |
| 장소 안 1인칭 탐색 | X | X | O | O |
| 일정과 현장의 연결 | 경로 단위 | X | 장소 하나씩 | 일정 → 동선 → 장소 한 흐름 |
| 국내 3D | 3D 정보 반출 제외 | – | 촬영된 곳만 | 국내 데이터로 구성 |

- AI 일정 앱: Wonderplan, iplan.ai, Stippl, MonkeyTravel, Trip.com Trip Planner 등
- 스플랫 가상 투어: Splat Tour, Splatware Virtual Tour Lab, 관광지·문화유산 Gaussian Splatting 사례 등

## 차별점

1. **실제 공간 데이터 + 월드모델 실사화**
   Google 3D가 닿지 않는 국내를 공공 데이터로 구성한다. 건물 윤곽·높이는 GIS건물통합정보, 지형은 DEM, 동선은 OSM·ODsay·카카오, 장소 정보는 TourAPI. 이 실제 3D에서 RGB와 형상 depth를 뽑아 월드모델(Cosmos-Transfer2.5)에 넣어 실사 장면을 만든다. 위치와 형상은 데이터가, 질감과 빛은 모델이 맡는다. 현장 사진 확인은 카카오 로드뷰(원본 그대로 임베드).

2. **일정과 현장을 한 흐름으로**
   목록이 아니라 투어다. 도착 시각에 맞춘 하늘과 조명(낮 / 골든아워 / 밤), 구간마다 무리한 동선 경고, 도착하면 그 자리에서 **들어가기**로 1인칭 전환.

3. **사실성을 숨기지 않는다**
   사전 답사는 틀리면 의미가 없다. LLM이 준 좌표는 지오코딩으로 검증하고 실패하면 `좌표 미확인`으로 표시한다. 샘플 장면은 "샘플 장면 · 실제 ○○ 아님", 생성 장면은 "AI 생성 장면"으로 항상 밝힌다. 월드모델이 만든 외벽·간판·밤 풍경은 실제 관측이 아니다.

## 실데이터 3D + 월드모델 실사화

```
실제 공간 데이터 (건물 윤곽·높이, 지형, 도로, 동선)
  → 3D 렌더 (Cesium) — 정해진 카메라 경로를 눈높이·조감으로
  → RGB 영상 + 실제 형상 depth 영상 (pickPosition 대비 오차 기록)
  → Cosmos-Transfer2.5 (depth·edge 조건) → 실사 영상 ("AI 생성 장면")
  → 다음 단계: 실사 영상 + 알려진 카메라 위치로 Gaussian Splatting 복원 → 앱에서 걸어 다니기
```

- **도쿄 (데모, 동결)**: 일본 PLATEAU(공개 3D 도시 데이터)로 도쿄타워 반경 1.5km. Phase 0 데이터([#21](https://github.com/UnderCruzer/rangseon-dapsa/issues/21)), 3D 검토 뷰어와 월드모델 입력([#24](https://github.com/UnderCruzer/rangseon-dapsa/issues/24)). 첫 Cosmos 실행은 [#30](https://github.com/UnderCruzer/rangseon-dapsa/issues/30).
- **서울 (본 작업)**: 남산 N서울타워 일대 ([#28](https://github.com/UnderCruzer/rangseon-dapsa/issues/28)). OSM 건물 중 높이 정보는 8.5%뿐이라 GIS건물통합정보로 채운다.
- **국내 처리 원칙**: 국내 3D·고해상도 영상 원천은 국외 서버로 보내지 않는다(정밀지도 반출 허가에서 3D 제외·국내 서버 가공 조건). 서울 월드모델은 국내 장비에서 실행한다.

| 국내 원천 | 사용 |
|---|---|
| GIS건물통합정보 (국토교통부, 공공누리 1유형) | 건물 윤곽·지상층수·높이 |
| 브이월드 WMTS | 항공사진 (`VWORLD_KEY`) |
| 브이월드 3D | 사용하지 않음 — 국가공간정보 보안관리규정상 공개제한 |
| S-Map (서울 디지털트윈) | 원본 외부 활용은 서울시 확인 후 |
| 카카오 로드뷰 | 원본 그대로 임베드만 (저장·가공 금지) |

## 지금 되는 것과 계획

| 기능 | 상태 | 내용 |
|---|---|---|
| 한 줄 → 일정 | ✅ | Claude 구조화 출력, 키가 없으면 데모 일정(부산·서울) |
| 좌표 검증 | ✅ | OpenStreetMap Nominatim으로 교정, 실패 시 표시 |
| 3D 동선 투어 | ✅ | 위성사진 + 지형 + 3D 건물, 자동 플라이스루, 시간대 조명 |
| 동선 경고 | ✅ | 직선거리·시간 간격으로 빠듯한 구간과 일정 겹침 표시 |
| 현장 확인 | ✅ | 국내는 카카오 로드뷰, 해외는 Google 스트리트뷰로 연결 |
| 장소 안 1인칭 | 🚧 | 뷰어·조이스틱 완료, 장면은 아직 **샘플** |
| 실데이터 3D 검토 뷰어 | ✅ | 도쿄 데모: PLATEAU 건물·도로·지형·항공사진, 객체 원본 속성 |
| 월드모델 입력 생성 | ✅ | 고정 카메라 경로(조감·눈높이) RGB + 형상 depth, Cosmos 설정 |
| 월드모델 실사화 | 🚧 | Cosmos-Transfer2.5 첫 실행 준비 (H100 80GB 필요, [#30](https://github.com/UnderCruzer/rangseon-dapsa/issues/30)) |
| 서울 실데이터 | 🚧 | 남산 OSM 수집 완료, 건물 높이·DEM 대기 ([#28](https://github.com/UnderCruzer/rangseon-dapsa/issues/28)) |
| Android 앱 | ✅ | Capacitor, 바텀시트·뒤로가기·화면 꺼짐 방지 |
| 국내 정밀 3D | 📋 | GIS건물통합정보 높이 + DEM 렌더러 |
| 국내 장소 데이터 | 📋 | TourAPI로 후보 조회 → 그 안에서만 일정 생성, 사진·운영시간 |
| 실제 이동 경로 | 📋 | 카카오모빌리티 / ODsay로 도보·대중교통 경로와 소요 시간 |
| 걸어 다니는 실사 장면 | 📋 | 실사화 영상 → Gaussian Splatting 복원 ([#2](https://github.com/UnderCruzer/rangseon-dapsa/issues/2)) |
| 앱용 API 서버 | 📋 | 원격 배포 ([#7](https://github.com/UnderCruzer/rangseon-dapsa/issues/7)) |

✅ 동작 · 🚧 일부 · 📋 계획. 도쿄 데모와 Google 실사 3D 모드는 해외와 비교하기 위한 용도로만 남겨 둔다.

## 실행

```bash
npm install
cp .env.example .env   # 키는 선택
npm run dev            # http://localhost:5173
npm run android:apk    # Android 디버그 APK (JDK 21 필요, AGENTS.md 참고)
```

| 구성 | 내용 |
|---|---|
| 일정 생성 | `server.js` → Claude(구조화 출력) → Nominatim으로 좌표 교정 |
| 기본 3D | MapLibre + Esri 위성사진 + AWS 지형 + OpenFreeMap 3D 건물 (키 불필요) |
| 실사 3D | CesiumJS + Google Photorealistic 3D Tiles (`GOOGLE_MAPS_API_KEY`, 해외 비교용) |
| 1인칭 탐색 | Spark(three.js)로 3D Gaussian Splatting 장면 렌더링. 장소별 장면(`stop.scene`)이 없으면 샘플 장면 |
| 데모 모드 | 키가 없으면 `web/src/presets.js`의 샘플 일정 |
| 앱 | Capacitor 8 Android (`dev.undercruzer.rangseondapsa`) |

도쿄 데모 (Python 3, Node, Chrome):

```bash
python3 -B scripts/phase1/serve.py                         # 3D 검토 뷰어 http://127.0.0.1:8792/review/phase1/
node scripts/phase1/export_frames.mjs --path tower-walk    # 월드모델 입력 (tower-orbit, tower-approach도 가능)
```

GPU 머신에서의 실행·기록·판정은 [docs/phase1/COSMOS.md](docs/phase1/COSMOS.md).

조작: ←/→ 이전·다음 장소, Space 자동 투어 일시정지, 지도를 드래그하면 투어가 멈춤.
현장 카드의 **들어가기**를 누르면 1인칭 모드: WASD 이동, E/Q 위·아래, 드래그로 둘러보기, Esc 나가기. 폰에서는 왼쪽 아래 조이스틱으로 걷는다.

## 장면 연결

`web/src/scenes.js`의 `sceneFor(stop)`이 장소별 장면을 고른다. 생성 파이프라인(#2)이 붙으면 장소에
`scene: { url, position }`을 채워 넣고, 그 전까지는 Spark 예제 에셋을 **샘플**로 표시해 보여준다.

## 참고

- [Ask Maps and Immersive Navigation](https://blog.google/products-and-platforms/products/maps/ask-maps-immersive-navigation/) (Google, 2026)
- [Immersive View for routes](https://blog.google/products-and-platforms/products/maps/google-maps-october-2023-update/) (Google, 2023)
- [18년 끌어온 구글 지도 반출 논쟁…'조건부 허가'로 마침표](https://zdnet.co.kr/view/?no=20260227120235) (ZDNet Korea, 2026-02-27)
- [정부 "3차원 정보는 반출 제외…레드버튼도 적용"](https://m.news.nate.com/view/20260227n28794) (2026-02-27)
- [Gaussian Splatting for Tourist Destinations and Cultural Heritage](https://innoarea.com/en/noticias/gaussian-splatting-heritage/)
- [Cosmos-Transfer2.5](https://research.nvidia.com/labs/cosmos-lab/cosmos-transfer2.5) (NVIDIA)
- [3D都市モデル PLATEAU](https://www.mlit.go.jp/plateau/) (국토교통성, 도쿄 데모 원천)
- [국토교통부_GIS건물통합정보](https://www.data.go.kr/data/15083092/fileData.do) (공공데이터포털)

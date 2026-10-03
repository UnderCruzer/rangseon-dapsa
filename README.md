# 랑선답사

**한 줄로 떠나는 국내 여행 사전 답사.**
"부산 당일치기, 바다 위주로" 한 줄이면 실제로 다닐 수 있는 동선을 짜고, 3D 지도 위에서 그 동선을 미리 날아가 보고, 도착한 장소 안을 1인칭으로 걸어 본다.

> 작업 규칙과 설계 원칙은 [AGENTS.md](AGENTS.md)를 먼저 읽는다.

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

1. **국내 데이터로 채운 3D 답사**
   Google 3D가 닿지 않는 국내를 국내 공공·민간 데이터로 구성한다. 지형·건물은 위성사진과 OSM에서 시작해 브이월드 3D로, 장소 후보·사진·운영 정보는 한국관광공사 TourAPI로, 현장 확인은 카카오 로드뷰로.

2. **일정과 현장을 한 흐름으로**
   목록이 아니라 투어다. 도착 시각에 맞춘 하늘과 조명(낮 / 골든아워 / 밤), 구간마다 무리한 동선 경고, 도착하면 그 자리에서 **들어가기**로 1인칭 전환.

3. **사실성을 숨기지 않는다**
   사전 답사는 틀리면 의미가 없다. LLM이 준 좌표는 지오코딩으로 검증하고 실패하면 `좌표 미확인`으로 표시한다. 샘플 장면은 "샘플 장면 · 실제 ○○ 아님", 생성 장면은 "AI 생성 장면"으로 항상 밝힌다.

## 지금 되는 것과 계획

| 기능 | 상태 | 내용 |
|---|---|---|
| 한 줄 → 일정 | ✅ | Claude 구조화 출력, 키가 없으면 데모 일정(부산·서울) |
| 좌표 검증 | ✅ | 한국관광공사 TourAPI 우선(공식 좌표·대표 사진·주소), 없으면 OpenStreetMap, 실패 시 "좌표 미확인" |
| 3D 동선 투어 | ✅ | 위성사진 + 지형 + 3D 건물, 자동 플라이스루, 시간대 조명 |
| 동선 경고 | ✅ | 직선거리·시간 간격으로 빠듯한 구간과 일정 겹침 표시 |
| 현장 확인 | ✅ | 국내는 카카오 로드뷰, 해외는 Google 스트리트뷰로 연결 |
| 장소 안 1인칭 | 🚧 | 뷰어·조이스틱 완료, 장면은 아직 **샘플** |
| Android 앱 | ✅ | Capacitor, 바텀시트·뒤로가기·화면 꺼짐 방지 |
| 국내 정밀 3D | 📋 | 브이월드 3D 건물·지형 렌더러 |
| 국내 장소 데이터 | 🚧 | 검증·사진·주소는 완료. TourAPI 후보 안에서만 일정 생성, 운영시간은 계획 |
| 실제 이동 경로 | 📋 | 카카오모빌리티 / ODsay로 도보·대중교통 경로와 소요 시간 |
| 실제 사진 기반 장면 | 📋 | 장소 사진 → 3D 월드 생성 ([#2](https://github.com/UnderCruzer/rangseon-dapsa/issues/2)) |
| 앱용 API 서버 | 📋 | 원격 배포 ([#7](https://github.com/UnderCruzer/rangseon-dapsa/issues/7)) |

✅ 동작 · 🚧 일부 · 📋 계획. 도쿄 데모와 Google 실사 3D 모드는 해외와 비교하기 위한 용도로만 남겨 둔다.

## 실행

```bash
npm install
cp .env.example .env   # 키는 선택
npm run dev            # http://localhost:5173
npm run dev:mock       # 키 없이 화면만 확인 (목업 일정)
npm run android:apk    # Android 디버그 APK (JDK 21 필요, AGENTS.md 참고)
```

| 구성 | 내용 |
|---|---|
| 일정 생성 | `server.js` → Claude(구조화 출력) → TourAPI(`TOURAPI_KEY`) → Nominatim 순으로 좌표 교정 |
| 기본 3D | MapLibre + Esri 위성사진 + AWS 지형 + OpenFreeMap 3D 건물 (키 불필요) |
| 실사 3D | CesiumJS + Google Photorealistic 3D Tiles (`GOOGLE_MAPS_API_KEY`, 해외 비교용) |
| 1인칭 탐색 | Spark(three.js)로 3D Gaussian Splatting 장면 렌더링. 장소별 장면(`stop.scene`)이 없으면 샘플 장면 |
| 데모 모드 | 키가 없으면 `web/src/presets.js`의 샘플 일정 |
| 앱 | Capacitor 8 Android (`dev.undercruzer.rangseondapsa`) |

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

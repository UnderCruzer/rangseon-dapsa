# AGENTS.md

Trip3D에서 작업하는 사람과 AI 에이전트가 따르는 단일 기준 문서. 여기와 다른 관행이 코드에 있으면 이 문서를 먼저 고치고 나서 코드를 맞춘다.

## 제품 한 줄

한 줄 프롬프트 → 실제 다닐 수 있는 여행 동선 → 3D 지도 위 플라이스루 → 장소 안 1인칭 탐색. **실제 가기 전 사전 답사**가 목적이라, 그럴듯함보다 사실성을 우선한다.

## 워크플로

1. **이슈 먼저.** 기능·수정·설정 변경은 이슈부터 만든다. 템플릿(`.github/ISSUE_TEMPLATE/`)을 쓰고 라벨을 2~4개 붙인다.
2. **브랜치**: `type/이슈번호-짧은-설명` (예: `feat/6-capacitor-android`). `main`에 직접 push하지 않는다.
3. **커밋은 작업 단위로 바로바로.** 파일·기능 하나가 끝나면 커밋한다. 뭉쳐서 찍고 되돌려 다시 나누지 않는다.
   - 형식: `type: 한국어 설명 (#이슈)` — type은 `feat` `fix` `chore` `docs` `refactor` `test`
   - `Co-Authored-By` 줄은 넣지 않는다.
4. **PR**: 본문에 `Closes #번호`, 변경 사항, 확인한 것 / 못 한 것을 체크리스트로. 선행 PR이 있으면 그 브랜치를 base로 쌓는다(stacked PR).
5. 머지는 merge commit(작업 단위 커밋 보존). 머지 후 브랜치 삭제.

### 라벨

| 라벨 | 용도 |
|---|---|
| `feature` | 새 기능 |
| `bug` | 버그 |
| `chore` | 설정·빌드·잡무 |
| `docs` | 문서 |
| `ai` | LLM·월드모델 |
| `mobile` | Android 앱·Capacitor |
| `backend` | API 서버 |
| `infra` | 배포·GPU·운영 |
| `external-api` | 외부 API 연동 |
| `qa` | 테스트·검증 |

사람(담당자) 라벨은 만들지 않는다. 담당은 assignee로 지정한다.

## 설계 원칙

1. **키는 서버에만.** Anthropic 키는 앱·웹 번들에 절대 넣지 않는다. 클라이언트는 `/api/*`만 호출한다. (Google Map Tiles 키는 원래 클라이언트용 키라 예외지만, 리퍼러·앱 제한을 건다.)
2. **LLM 좌표는 믿지 않는다.** 생성된 장소는 지오코딩으로 검증하고, 검증 못 한 장소는 UI에 `좌표 미확인`으로 표시한다.
3. **생성물은 생성물이라고 말한다.** 샘플 장면은 "샘플 장면 · 실제 ○○ 아님", AI 생성 장면은 "AI 생성 장면"으로 항상 표시한다.
4. **3D는 웹에 둔다.** 지도(MapLibre·Cesium)와 1인칭 뷰어(Spark·three.js)는 WebGL 코드로 유지하고, 앱은 Capacitor로 감싼다. 기기 기능이 필요할 때만 Capacitor 플러그인을 쓴다.
5. **키 없이도 돈다.** Claude 키가 없으면 데모 일정, Google 키가 없으면 위성 3D로 동작해야 한다. 새 기능도 같은 원칙으로 대체 경로를 둔다.
6. **무거운 것은 필요할 때만.** three·Spark·Cesium은 해당 모드에 처음 들어갈 때 동적으로 불러온다.

## 구조

```
server.js              API 서버 (/api/config, /api/plan) + 운영 시 dist/ 서빙
vite.config.js         Vite 설정 (root: web, 개발 중 /api → 8787 프록시)
web/
  index.html           화면 뼈대
  src/
    app.js             진입점: 투어 진행·일정 목록·동선 경고
    config.js          API 주소 (VITE_API_BASE)
    renderer-*.js      지도 렌더러 (maplibre: 기본, cesium: Google 실사)
    explore.js         1인칭 스플랫 뷰어 (동적 import)
    scenes.js          장소 → 장면 연결
    presets.js         데모 일정
    style.css
dist/                  빌드 결과 (커밋하지 않음)
```

라이브러리는 npm으로 번들한다(maplibre-gl, three, @sparkjsdev/spark, pretendard). 예외: Cesium은 실사 모드 전용이고 정적 자산이 많아 CDN에서 동적 로드한다.

렌더러는 같은 인터페이스(`init` `show` `hide` `setStops` `highlight` `overview` `flyTo` `startOrbit` `stopOrbit` `setPhase`)를 구현한다. 새 렌더러를 추가하면 이 목록을 맞춘다.

## 실행

```bash
npm install
cp .env.example .env   # 키는 선택
npm run dev            # 웹 http://localhost:5173 + API :8787
npm run build          # dist/ 생성
npm start              # API + dist/ 서빙 (운영과 같은 구성)
```

| 환경변수 | 어디서 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 서버 | 있으면 실제 일정 생성, 없으면 데모 |
| `GOOGLE_MAPS_API_KEY` | 서버 → `/api/config`로 전달 | 있으면 실사 3D 토글 |
| `API_PORT` / `PORT` | 서버 | API 포트. `API_PORT` 우선 (기본 8787) |
| `VITE_API_BASE` | 웹 빌드 | 앱처럼 API가 다른 출처에 있을 때 서버 주소 |

## 하지 말 것

- 앱·웹 코드에 Anthropic 키, 서버 비밀값 넣기
- 검증 없이 LLM이 준 좌표로 "도착" 연출하기
- 샘플·생성 장면을 실제 장소처럼 보여주기
- 라이선스 확인 없이 외부 모델·에셋을 번들에 포함하기 (출처는 `scenes.js`나 README에 기록)

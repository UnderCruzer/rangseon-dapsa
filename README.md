# Trip3D

> 작업 규칙과 설계 원칙은 [AGENTS.md](AGENTS.md)를 먼저 읽는다.

한 줄 프롬프트로 여행 동선을 만들고, 3D 지도 위에서 그 동선을 미리 따라가 보는 프로토타입.

```
npm install
cp .env.example .env   # 키는 선택
npm start              # http://localhost:5173
```

| 구성 | 내용 |
|---|---|
| 일정 생성 | `server.js` → Claude(구조화 출력) → Nominatim으로 좌표 교정 |
| 기본 3D | MapLibre + Esri 위성사진 + AWS 지형 + OpenFreeMap 3D 건물 (키 불필요) |
| 실사 3D | CesiumJS + Google Photorealistic 3D Tiles (`GOOGLE_MAPS_API_KEY`) |
| 1인칭 탐색 | Spark(three.js)로 3D Gaussian Splatting 장면 렌더링. 장소별 장면(`stop.scene`)이 없으면 샘플 장면 |
| 데모 모드 | 키가 없으면 `public/presets.js`의 부산·서울·도쿄 샘플 일정 |

조작: ←/→ 이전·다음 장소, Space 자동 투어 일시정지, 지도를 드래그하면 투어가 멈춤.
현장 카드의 **들어가기**를 누르면 1인칭 모드: WASD 이동, E/Q 위·아래, 드래그로 둘러보기, Esc 나가기.

## 장면 연결

`public/scenes.js`의 `sceneFor(stop)`이 장소별 장면을 고른다. 생성 파이프라인(#2)이 붙으면 장소에
`scene: { url, position }`을 채워 넣고, 그 전까지는 Spark 예제 에셋을 **샘플**로 표시해 보여준다.

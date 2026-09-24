# Trip3D

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
| 데모 모드 | 키가 없으면 `public/presets.js`의 부산·서울·도쿄 샘플 일정 |

조작: ←/→ 이전·다음 장소, Space 자동 투어 일시정지, 지도를 드래그하면 투어가 멈춤.

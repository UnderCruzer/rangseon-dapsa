# Phase 0 — 데이터와 계산 방법

## 원본과 재현

OSM © OpenStreetMap contributors, ODbL 1.0. 라이선스: https://www.openstreetmap.org/copyright . Wikidata 구조화 정보 CC0. Commons 사진별 라이선스는 `data/processed/wikidata.json` 참조. 공식 사이트의 페이지 본문은 로컬 증거용으로만 보관하고 Git에는 사실 전사·URL·수집시각·해시를 보관한다.

`data/sources.json`의 URL·쿼리·UTC 수집시각·SHA-256이 수집 기록이다. OSM은 처음 두 공개 서버의 시간초과 후 OSM Wiki에 열거된 VK Maps Overpass 인스턴스에서 수집했다. `osm-area.json.gz`는 원본 응답 bytes를 lossless gzip으로 압축했고 해시는 압축 전 bytes 기준이다. API 요청은 `collect.py --stage ...`로 수집하며, 재가공은 저장된 스냅샷만 읽는다. **같은 스냅샷에서 같은 산출물**을 재현한다. `--refresh`로 온라인 재수집하면 수정된 OSM과 달라질 수 있다. 수집 명령을 동시에 실행하지 않는다(공용 manifest 갱신).

- 앵커: OSM relation/4247312, Overpass가 반환한 대표 좌표 35.6585639, 139.74544. 실제 출입구 좌표로 간주하지 않는다.
- 범위: 해당 좌표 반경 1,500m. 경로 연결을 위해 highway ways를 2,200m까지 추가 수집. 긴 관계의 멤버는 원본에 경계 밖까지 포함될 수 있다.
- 가공 core: 노드 자체 좌표 또는 객체 bounds 중점이 반경 1,500m 안인 객체. 경계를 지나는 geometry는 자르지 않으며 정확한 원형 clip이 아님을 명시한다.
- CSV는 OSM 필드를 그대로 옮긴 투영본이다. 없는 열은 빈칸. name을 번역·보정하지 않는다. category는 원본 분류 태그 key=value를 합친 표현이다. 모든 태그·geometry는 원본 JSON이 권위본이다.
- raw way/relation lat/lng는 원본에 직접 존재하지 않으면 빈칸. 가공 places의 좌표는 bounds 중점이며 entrance가 아니다. `osm-row-index.json`은 헤더 포함 CSV 행 번호 → OSM ID/version/timestamp.
- duration_min raw는 모두 빈칸. 방문 시간·체류 시간은 운영 주체가 공표한 사실이 아니라 별도의 검토용 계획 제안이다. 평점 미수집.
- 전체 장소 5천여 개에 Wikidata가 모두 있는 것은 아니다. 이 단계의 상세 Wikidata·Commons 대조 범위는 Day 1 핵심 3명소. 나머지는 미확인으로 남긴다. 브랜드 회사 ID를 지점 공식 정보로 자동 치환하지 않는다.

## 보행

`process.py`: 실제 way의 이웃 OSM node ID만 간선으로 연결. 보이는 선의 교차를 임의 접속하지 않는다. 허용 보행로·생활도로·일반도로 중 명시적 보행 금지/private/조건부 접근 등을 제외한다. 자동차 일방통행은 보행에 전파하지 않고 `oneway:foot`를 적용한다. 태그가 없는 제한·현장 통행 가능성까지 검증된 것은 아니다. 별도 인도가 누락된 일반 도로의 중심선도 포함될 수 있어 **모든 선이 실제 인도라고 하지 않는다**.

각 간선 길이는 WGS84 위경도에 지구 평균반경 6,371,008.8m의 haversine 계산. Dijkstra 최단거리. 고도·계단 상승·보행 속도 변화는 반영하지 않는다. 속도 **4.5km/h는 사용자 검토용 모델 매개변수**이며 도쿄에서 실측한 값이 아니다. 따라서 시간은 ‘추정’. 현재 보행 그래프 합계에 출입구 connector, 신호 대기, 식사 대기, 휴식은 포함하지 않는다.

선택 장소 대표점에서 가장 가까운 그래프 노드까지는 실제 연결을 보장할 수 없으므로 `endpoint_gaps_m`로 공개한다. 그 틈을 직선 경로로 채우거나 전체 출입구간을 검증했다고 하지 않는다. 원점부터 목적지까지 검증된 전체 거리는 null.

## 택시와 지하철

택시 대안(`taxi.py`)은 모터차량 허용 도로, 일방통행, 노드 회전 금지/only 회전을 적용해 별도 계산한다. 조건부·via-way 회전은 해당 from way를 보수적으로 제외한다. 이는 데이터 범위 안 **거리 시나리오**이며 실제 내비게이션이 아니다. 승하차 가능 지점, 지도에 누락된 회전/진입 제한·현재 교통은 미확인. 15km/h는 도로 거리→시간 변환의 검토용 가정이다. 값이 계산되지 않는 대안은 null로 남긴다. 요금은 미확인.

지하철: Toei 공식 페이지에서 大門(E20) → 赤羽橋(E21) → 麻布十番(E22) 순서를 확인. 직접 수집 페이지는 anti-bot challenge라 본문 증거로 사용하지 않았고 브라우저 검색 도구로 공식 문서를 확인했다. 승차시간·대기시간·환승 동선은 확인하지 못해 null. 짧은 Day 1에 지하철을 시연 목적으로 강제로 끼워 넣지 않는다.

## 일출·일몰

`solar.py`는 NOAA가 공개한 fractional-year 근사 방정식(https://gml.noaa.gov/grad/solcalc/solareqns.PDF)을 구현한다. declination·equation of time·hour angle에서 고도를 계산하고 Asia/Tokyo 하루를 1분 단위 탐색해 태양 중심 고도 -0.833° 교차를 찾는다. NOAA의 전체 Meeus 계산기와 동일한 정밀 구현은 아니다. 고도 지형·건물 가림과 실제 대기·날씨는 반영하지 않는다. 1분 표기는 수치 탐색 간격이며 정확도 보장이 아니다.

여행 날짜가 없으면 일출·일몰 모두 null. 날짜를 받으면 재생성하고 공식 점등 달력의 그 날짜를 다시 확인한다. 일반 조명 규칙만으로 특별 점등을 확정하지 않는다. 골든아워 연출 시간 폭·색·강도는 아직 정하지 않았다(Phase 1 대상).

## 영업시간 대조

원본은 덮어쓰지 않고 `hours-checks.json`에 대조 결과를 추가한다. 도쿄타워 일반시간 일치. 조조지 부지 24/7과 본당 06:00–17:30은 **대상 범위가 다른 값**으로 기록한다. 주차장·사무소·공원 시설의 시간을 해당 장소 전체로 잘못 적용하지 않는다. 연휴·임시 휴관·공사·매장별 예외는 미확인. 조조지 영문 안내의 삼해탈문 보수 공사 정보도 방문 당일 재확인 필요.

## 실행

```sh
# 최초 수집 (공개 API 읽기)
python3 -B scripts/phase0/collect.py --stage osm --endpoint https://maps.mail.ru/osm/tools/overpass/api/interpreter
python3 -B scripts/phase0/collect.py --stage official
python3 -B scripts/phase0/collect.py --stage wikidata --ids Q183536 Q249139 Q3266956
python3 -B scripts/phase0/enrich.py

# 커밋된 스냅샷으로 재생성 (기본 네트워크 없음)
python3 -B scripts/phase0/process.py
# 날짜를 받은 경우만 process.py --date YYYY-MM-DD
python3 -B scripts/phase0/plan.py
python3 -B scripts/phase0/taxi.py
# validate.py는 아직 없음. 재현성은 재생성 전후 산출물 SHA-256 비교로 확인 (2026-10-03, 동일)

# 앱과 독립된 BEFORE 검토 페이지
python3 -B scripts/phase0/serve.py
# http://127.0.0.1:8791/review/phase0/
```

# 월드모델 실사화 실행 — Cosmos-Transfer2.5

실제 PLATEAU 3D 렌더(RGB)와 **실제 형상에서 계산한 depth**를 조건으로 넣어 실사 영상을 만든다. 결과는 AI 생성 영상이며 관측 사진이 아니다. 화면에는 항상 "AI 생성 장면"으로 표시한다.

## 1. 입력 만들기 (Mac 가능, GPU 불필요)

```sh
# :8792 검토 서버가 꺼져 있으면 스크립트가 직접 띄운다. Chrome 경로는 CHROME_PATH로 변경
node scripts/phase1/export_frames.mjs --path tower-orbit
node scripts/phase1/export_frames.mjs --path tower-approach
```

`data/phase1/exports/<path>/`에 생성된다.

| 파일 | 내용 |
|---|---|
| `rgb.mp4` | 실제 3D 렌더, 1280×720, 16fps, 93프레임 |
| `depth.mp4` | 역깊이(가까울수록 밝음). 범위는 manifest `path.depth` |
| `manifest.json` | 카메라(ECEF)·출처·해시·depth 검증(pickPosition 대비 오차)·타일 미완료 프레임 |
| `cosmos-spec-day.json`, `cosmos-spec-night.json` | 추론 설정 (depth 1.0 + 모델 계산 edge 0.5) |
| `prompt-day.txt`, `prompt-night.txt` | 생성 프롬프트 |

카메라 경로는 `review/phase1/export.js`의 `PATHS`. 측정 궤적이 아니라 연출 값이다. 프레임 PNG(`frames/`)는 커밋하지 않는다.

## 2. GPU 환경

공식 요구사항([setup.md](https://github.com/nvidia-cosmos/cosmos-transfer2.5/blob/main/docs/setup.md)): Linux x86-64, glibc ≥2.35(Ubuntu ≥22.04), Ampere 이상 NVIDIA GPU, 드라이버 ≥570.124.06(CUDA 12.8). Windows는 WSL2 Ubuntu에서 시도한다(공식 지원 목록에는 없음).

메모리: 2B 모델 720p 단일 GPU 65.4GB([model matrix](https://docs.nvidia.com/cosmos/latest/transfer2.5/model_matrix.html)) → A100/H100 80GB. 24~32GB 데스크탑 GPU는 해상도를 낮춰야 하며 동작은 미검증.

```sh
git clone https://github.com/nvidia-cosmos/cosmos-transfer2.5.git && cd cosmos-transfer2.5
git lfs pull
uv python install && uv sync --extra=cu128 && source .venv/bin/activate
hf auth login     # Read 권한 토큰
```

체크포인트는 추론 시 자동으로 받는다. **NVIDIA Open Model License 동의는 Hugging Face에서 사용자가 직접 한다**([Cosmos-Guardrail1](https://huggingface.co/nvidia/Cosmos-Guardrail1)).

## 3. 실행

이 리포의 export 폴더를 GPU 머신으로 복사한 뒤(spec의 경로는 spec 파일 기준 상대경로):

```sh
python examples/inference.py -i <rangseon>/data/phase1/exports/tower-orbit/cosmos-spec-day.json -o outputs/tower-orbit-day
```

## 4. 기록과 판정 (실행 후 필수)

`data/phase1/runs/<path>-<day|night>/`에 결과 mp4와 `run.json`을 남긴다: 모델·체크포인트 이름/리비전, 리포 커밋, GPU 종류, 실행 시간, 비용, spec 원문, 입력 해시(manifest의 `files`).

판정은 같은 프레임에서 원본 RGB와 나란히 비교한다. 다음 중 하나라도 있으면 불합격이다.

- 도쿄타워 위치·형태가 바뀌었다
- 주요 건물이 생기거나 사라졌거나 교차로 연결이 바뀌었다
- 프레임 사이에 건물이 흔들리거나 변형된다

수치 허용 오차는 아직 정하지 않았다. 밤 장면은 실제 야간 관측이 아니라 시뮬레이션이다.

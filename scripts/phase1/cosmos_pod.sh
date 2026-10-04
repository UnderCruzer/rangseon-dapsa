#!/usr/bin/env bash
# Run on the GPU machine (Linux x86-64, NVIDIA Ampere+, CUDA 12.8 driver).
#   cosmos_pod.sh setup                      install Cosmos-Transfer2.5 under $WORK
#   cosmos_pod.sh run <spec.json> <name>     run one spec and write outputs/<name>/run.json
# HF_TOKEN must be set in the environment by the account owner (e.g. RunPod env vars), with the
# NVIDIA Open Model License accepted on Hugging Face. This script never asks for or stores it.
set -euo pipefail

WORK=${WORK:-/workspace}
REPO=$WORK/cosmos-transfer2.5
export HF_HOME=${HF_HOME:-$WORK/hf}

setup() {
  command -v git-lfs >/dev/null && command -v ffmpeg >/dev/null || {
    apt-get update -qq && apt-get install -y -qq git-lfs ffmpeg
  }
  git lfs install
  [ -d "$REPO" ] || git clone https://github.com/nvidia-cosmos/cosmos-transfer2.5.git "$REPO"
  cd "$REPO" && git lfs pull
  command -v uv >/dev/null || { curl -LsSf https://astral.sh/uv/install.sh | sh; }
  export PATH="$HOME/.local/bin:$PATH"
  uv python install && uv sync --extra=cu128
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
}

run() {
  local spec=$1 name=$2
  [ -n "${HF_TOKEN:-}" ] || { echo "HF_TOKEN is not set" >&2; exit 1; }
  cd "$REPO"
  local out=$WORK/outputs/$name
  mkdir -p "$out"
  local start=$(date -u +%s)
  .venv/bin/python examples/inference.py -i "$spec" -o "$out" 2>&1 | tee "$out/inference.log"
  local end=$(date -u +%s)
  python3 - "$spec" "$out" "$start" "$end" <<'EOF'
import json, subprocess, sys, hashlib, pathlib
spec, out, start, end = sys.argv[1], pathlib.Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
sh = lambda *c: subprocess.run(c, capture_output=True, text=True).stdout.strip()
videos = sorted(out.rglob('*.mp4'))
json.dump({
    'model': 'Cosmos-Transfer2.5-2B',
    'repo_commit': sh('git', '-C', str(pathlib.Path.cwd()), 'rev-parse', 'HEAD'),
    'gpu': sh('nvidia-smi', '--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'),
    'started_utc': start, 'seconds': end - start,
    'spec': json.loads(pathlib.Path(spec).read_text()),
    'outputs': {str(v.relative_to(out)): hashlib.sha256(v.read_bytes()).hexdigest() for v in videos},
    'note': 'AI-generated video conditioned on rendered PLATEAU geometry; not an observed photo.',
}, open(out / 'run.json', 'w'), ensure_ascii=False, indent=2)
print('wrote', out / 'run.json')
EOF
}

case ${1:-} in
  setup) setup ;;
  run) run "$2" "$3" ;;
  *) echo "usage: $0 setup | run <spec.json> <name>" >&2; exit 2 ;;
esac

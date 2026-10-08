#!/usr/bin/env bash
# Run on the GPU machine (Linux x86-64, NVIDIA Ampere+, CUDA 12.8 driver).
#   cosmos_pod.sh setup3                               Cosmos3 (diffusers) venv + NVIDIA negative prompt
#   cosmos_pod.sh run3 <export dir> <prompt.json> <name>  depth transfer → outputs/<name>/{vision.mp4,run.json}
#   cosmos_pod.sh setup | run <spec.json> <name>       Cosmos-Transfer2.5 (maintenance-only upstream)
# Cosmos3-Nano is not gated. Transfer2.5 needs HF_TOKEN set by the account owner (e.g. RunPod env
# vars) with the NVIDIA Open Model License accepted. This script never asks for or stores tokens.
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

COSMOS3_VENV=$WORK/.venv-cosmos3
NEGATIVE=$WORK/cosmos3-negative_prompt.json

setup3() {
  apt-get update -qq && apt-get install -y -qq ffmpeg libxcb1 libgl1 libglib2.0-0
  curl -LsSf https://astral.sh/uv/install.sh | sh   # cookbook needs uv >= 0.11.3
  export PATH="$HOME/.local/bin:$PATH" UV_LINK_MODE=copy
  uv venv "$COSMOS3_VENV" --python 3.13 --seed --managed-python --allow-existing
  uv pip install --python "$COSMOS3_VENV/bin/python" --torch-backend=cu128 \
    "diffusers @ git+https://github.com/huggingface/diffusers.git" \
    accelerate av huggingface_hub imageio imageio-ffmpeg torch torchvision transformers
  curl -fsSL -o "$NEGATIVE" \
    https://raw.githubusercontent.com/NVIDIA/cosmos/main/cookbooks/cosmos3/generator/transfer/assets/negative_prompt.json
  "$COSMOS3_VENV/bin/python" -c "import torch, diffusers; print(diffusers.__version__, torch.__version__, torch.cuda.is_available())"
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
}

run3() {
  local input=$1 prompt=$2 name=$3
  "$COSMOS3_VENV/bin/python" "$(dirname "$0")/cosmos3_transfer.py" \
    --input "$input" --prompt "$prompt" --negative "$NEGATIVE" --out "$WORK/outputs/$name" \
    2>&1 | tee "$WORK/outputs/$name.log"
}

case ${1:-} in
  setup3) setup3 ;;
  run3) mkdir -p "$WORK/outputs"; run3 "$2" "$3" "$4" ;;
  setup) setup ;;
  run) run "$2" "$3" ;;
  *) echo "usage: $0 setup3 | run3 <export dir> <prompt.json> <name> | setup | run <spec.json> <name>" >&2; exit 2 ;;
esac

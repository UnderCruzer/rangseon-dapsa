#!/usr/bin/env python3
"""Cosmos3 depth transfer on one exported input (GPU machine only).

Mirrors NVIDIA's cookbooks/cosmos3/generator/transfer/run_video_transfer_with_diffusers.ipynb
and specs/depth.json. Writes vision.mp4 and run.json. The output is AI-generated video
conditioned on rendered PLATEAU geometry, never an observed photo.
"""
import argparse
import hashlib
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULTS = {  # specs/depth.json in the Cosmos3 transfer cookbook
    'resolution': 720, 'aspect_ratio': (16, 9), 'num_frames': 121, 'fps': 30, 'shift': 10.0,
    'num_steps': 50, 'seed': 2026, 'num_video_frames_per_chunk': 121, 'num_conditional_frames': 1,
    'guidance': 3.0, 'control_guidance': 1.5,
}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compact(path):
    return json.dumps(json.loads(Path(path).read_text()), ensure_ascii=True, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', type=Path, required=True, help='export dir with depth.mp4 and manifest.json')
    ap.add_argument('--prompt', type=Path, required=True, help='structured prompt JSON')
    ap.add_argument('--negative', type=Path, required=True, help="NVIDIA cookbook assets/negative_prompt.json")
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--model', default='nvidia/Cosmos3-Nano')
    ap.add_argument('--steps', type=int, default=DEFAULTS['num_steps'])
    ap.add_argument('--seed', type=int, default=DEFAULTS['seed'])
    ap.add_argument('--control-guidance', type=float, default=DEFAULTS['control_guidance'])
    args = ap.parse_args()

    import torch
    import diffusers
    from diffusers import Cosmos3OmniModularPipeline
    from diffusers.schedulers.scheduling_unipc_multistep import UniPCMultistepScheduler
    from diffusers.utils import export_to_video, load_video
    from huggingface_hub import model_info

    depth = args.input / 'depth.mp4'
    manifest = json.loads((args.input / 'manifest.json').read_text())
    assert manifest['files']['depth.mp4']['sha256'] == sha256(depth), 'depth.mp4 does not match manifest'
    video = manifest['video']
    assert (video['frames'], video['fps']) == (DEFAULTS['num_frames'], DEFAULTS['fps']), \
        f"export with --frames {DEFAULTS['num_frames']} --fps {DEFAULTS['fps']}"

    height = DEFAULTS['resolution']
    width = round(height * DEFAULTS['aspect_ratio'][0] / DEFAULTS['aspect_ratio'][1])
    args.out.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    pipe = Cosmos3OmniModularPipeline.from_pretrained(args.model, torch_dtype=torch.bfloat16)
    pipe.load_components(torch_dtype=torch.bfloat16)
    pipe.to('cuda')
    load_s = time.time() - t0
    pipe.disable_safety_checker()  # as in the cookbook for edge/depth controls
    pipe.scheduler = UniPCMultistepScheduler.from_config(
        pipe.scheduler.config, flow_shift=DEFAULTS['shift'], use_karras_sigmas=False)

    t1 = time.time()
    videos = pipe(
        prompt=compact(args.prompt),
        negative_prompt=compact(args.negative),
        control_videos={'depth': load_video(str(depth))},
        control_guidance=args.control_guidance,
        num_frames=DEFAULTS['num_frames'],
        num_video_frames_per_chunk=DEFAULTS['num_video_frames_per_chunk'],
        num_conditional_frames=DEFAULTS['num_conditional_frames'],
        height=height, width=width, fps=float(DEFAULTS['fps']),
        num_inference_steps=args.steps, guidance_scale=DEFAULTS['guidance'],
        generator=torch.Generator(device='cuda').manual_seed(args.seed),
        output='videos',
    )
    gen_s = time.time() - t1
    output = args.out / 'vision.mp4'
    export_to_video(videos, str(output), fps=DEFAULTS['fps'], macro_block_size=1)

    gpu = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'],
                         capture_output=True, text=True).stdout.strip()
    (args.out / 'run.json').write_text(json.dumps({
        'kind': 'ai_generated_video_not_observed',
        'model': args.model, 'model_revision': model_info(args.model).sha,
        'diffusers': diffusers.__version__, 'torch': torch.__version__, 'gpu': gpu,
        'peak_cuda_gib': round(torch.cuda.max_memory_allocated() / 1024**3, 1),
        'finished_utc': datetime.now(timezone.utc).isoformat(),
        'seconds': {'load': round(load_s), 'generate': round(gen_s)},
        'params': {**DEFAULTS, 'num_steps': args.steps, 'seed': args.seed,
                   'control_guidance': args.control_guidance, 'control': 'depth'},
        'inputs': {'depth.mp4': sha256(depth), 'prompt': sha256(args.prompt), 'negative': sha256(args.negative),
                   'export_manifest': manifest['files']},
        'output': {'vision.mp4': sha256(output)},
    }, ensure_ascii=False, indent=2) + '\n')
    print(f'wrote {output} (load {load_s:.0f}s, generate {gen_s:.0f}s)')


if __name__ == '__main__':
    main()

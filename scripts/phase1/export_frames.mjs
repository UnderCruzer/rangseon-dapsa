#!/usr/bin/env node
// Render a fixed camera path over the real PLATEAU scene in headless Chrome and
// write world-model inputs: RGB video, geometry depth video, camera per frame,
// sources. No model is executed here.
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://127.0.0.1:8792';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const {values: opt} = parseArgs({options: {
  path: {type: 'string', default: 'tower-orbit'},
  frames: {type: 'string', default: '93'}, // Cosmos-Transfer2.5 benchmark clip: 93 frames
  fps: {type: 'string', default: '16'},
  width: {type: 'string', default: '1280'},
  height: {type: 'string', default: '720'},
}});
const frames = Number(opt.frames), fps = Number(opt.fps);
const width = Number(opt.width), height = Number(opt.height);
const out = join(ROOT, 'data/phase1/exports', opt.path);

// Generation prompts. Output of a model run is AI-generated video, never an observed photo.
const PROMPTS = {
  day: 'Photorealistic aerial drone footage of central Tokyo on a clear afternoon. Tokyo Tower, a red and white steel lattice tower, stands in the middle surrounded by green park trees. Dense mid-rise and high-rise office buildings with glass and concrete facades, streets with lane markings. Natural sunlight, realistic materials and shadows, smooth steady camera motion. Keep every building, road and the tower exactly where they are; do not add or remove structures.',
  night: 'Photorealistic aerial drone footage of central Tokyo at night. Tokyo Tower is illuminated with warm orange floodlights. Office buildings show lit windows, streets glow with streetlights and car light trails. Clear dark blue sky, realistic night exposure, smooth steady camera motion. Keep every building, road and the tower exactly where they are; do not add or remove structures.',
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const png = (dataUrl) => Buffer.from(dataUrl.split(',', 2)[1], 'base64');

async function reachable() {
  try { return (await fetch(`${BASE}/review/phase1/`)).ok; } catch { return false; }
}

async function ensureServer() {
  if (await reachable()) return null;
  const server = spawn('python3', ['-B', 'scripts/phase1/serve.py'], {cwd: ROOT, stdio: 'ignore'});
  for (let i = 0; i < 50; i++) {
    if (await reachable()) return server;
    await new Promise((r) => setTimeout(r, 200));
  }
  server.kill();
  throw new Error('Review server did not start on :8792');
}

function encode(pattern, file) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', pattern,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', file]);
}

const server = await ensureServer();
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', `--window-size=${width},${height}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({width, height, deviceScaleFactor: 1});
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/review/phase1/?export=1`, {waitUntil: 'load'});
  await page.waitForFunction(() => window.__exportApi, {timeout: 180000});
  if (!(await page.evaluate((p) => window.__exportApi.paths.includes(p), opt.path))) {
    throw new Error(`Unknown path ${opt.path}`);
  }

  rmSync(out, {recursive: true, force: true});
  mkdirSync(join(out, 'frames/rgb'), {recursive: true});
  mkdirSync(join(out, 'frames/depth'), {recursive: true});
  const cameras = [];
  const incomplete = [];
  const depthChecks = [];
  for (let i = 0; i < frames; i++) {
    const t = frames === 1 ? 0 : i / (frames - 1);
    const check = i % 10 === 0 || i === frames - 1;
    const f = await page.evaluate((p, t, c) => window.__exportApi.frame(p, t, c), opt.path, t, check);
    const name = String(i).padStart(5, '0') + '.png';
    writeFileSync(join(out, 'frames/rgb', name), png(f.rgb));
    writeFileSync(join(out, 'frames/depth', name), png(f.depth));
    cameras.push({frame: i, t, ...f.camera});
    if (!f.tiles_complete) incomplete.push(i);
    if (f.depth_check) depthChecks.push({frame: i, ...f.depth_check});
    process.stdout.write(`\r${opt.path} ${i + 1}/${frames}`);
  }
  process.stdout.write('\n');

  encode(join(out, 'frames/rgb/%05d.png'), join(out, 'rgb.mp4'));
  encode(join(out, 'frames/depth/%05d.png'), join(out, 'depth.mp4'));

  const {PATHS} = await import(join(ROOT, 'review/phase1/export.js'));
  const [near, far] = PATHS[opt.path].depth;
  const availability = JSON.parse(readFileSync(join(ROOT, 'data/realworld/availability.json')));
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({
    schema_version: 1,
    kind: 'rendered_control_inputs_not_observed_video',
    model_executed: false,
    created_at: new Date().toISOString(),
    path: {name: opt.path, ...PATHS[opt.path], note: 'Presentation camera path, not a measured trajectory.'},
    video: {frames, fps, width, height, codec: 'h264 yuv420p crf 12'},
    files: Object.fromEntries(['rgb.mp4', 'depth.mp4'].map((f) => [f, {sha256: sha256(join(out, f))}])),
    depth: {
      method: 'Cesium log depth buffer → view-axis eye depth; geometry of the rendered PLATEAU tiles and terrain',
      encoding: `inverse depth normalized, 8-bit: 1 at ${near} m (closer saturates), 0 at ${far} m or sky`,
      checks_vs_pickPosition: depthChecks,
    },
    rgb: 'Unlit PLATEAU LOD3 textures, PLATEAU terrain, GSI seamlessphoto imagery; fog off; UI hidden',
    frames_with_incomplete_tiles: incomplete,
    page_errors: errors,
    datasets: availability.datasets.filter((r) => ['13103_bldg_lod3', '13103_tran_lod3'].includes(r.id)),
    attribution: 'PLATEAU / 港区; PLATEAU | Mapterhorn | 国土地理院; © OpenStreetMap contributors',
    notices: ['Live tile bodies are not hashed and may change between exports.'],
    renderer: {chrome: await browser.version()},
    cameras,
  }, null, 2) + '\n');
  // Cosmos-Transfer2.5 inference specs (examples/inference.py -i <spec>). Depth comes from the real
  // geometry; edge is left for the model to compute from rgb.mp4.
  for (const [name, prompt] of Object.entries(PROMPTS)) {
    writeFileSync(join(out, `prompt-${name}.txt`), prompt + '\n');
    writeFileSync(join(out, `cosmos-spec-${name}.json`), JSON.stringify({
      name: `${opt.path}-${name}`, prompt_path: `prompt-${name}.txt`, video_path: 'rgb.mp4', guidance: 3,
      depth: {control_path: 'depth.mp4', control_weight: 1.0},
      edge: {control_weight: 0.5},
    }, null, 2) + '\n');
  }
  console.log('wrote', relative(ROOT, out), incomplete.length ? `(incomplete tiles in ${incomplete.length} frames)` : '');
} finally {
  await browser.close();
  server?.kill();
}

#!/usr/bin/env python3
"""브이월드 2D 데이터 LT_C_SPBD(도로명주소 건물) around N Seoul Tower.

Default reuses saved responses and checks hashes; --refresh fetches again with VWORLD_KEY from .env.
The key is never written to disk or printed: manifests store the request without it.
"""
import argparse
import gzip
import hashlib
import json
import math
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data/seoul'
SNAP = DATA / 'snapshots/vworld-spbd'
MANIFEST = DATA / 'sources.json'
ENDPOINT = 'https://api.vworld.kr/req/data'
LAT, LON = 37.5512605, 126.98822  # OSM relation/16474080 남산서울타워
RADIUS_M = 1500
CELL_DEG = 0.005  # request boxes; small enough to stay well inside API limits
PAGE_SIZE = 1000


def env_key():
    for line in (ROOT / '.env').read_text().splitlines():
        if line.startswith('VWORLD_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return ''


def cells():
    dlat = RADIUS_M / 111_320
    dlon = RADIUS_M / (111_320 * math.cos(math.radians(LAT)))
    y = LAT - dlat
    while y < LAT + dlat:
        x = LON - dlon
        while x < LON + dlon:
            yield (round(x, 6), round(y, 6), round(min(x + CELL_DEG, LON + dlon), 6), round(min(y + CELL_DEG, LAT + dlat), 6))
            x += CELL_DEG
        y += CELL_DEG


def request(key, box, page):
    params = {'service': 'data', 'request': 'GetFeature', 'data': 'LT_C_SPBD', 'domain': 'http://localhost',
              'geomFilter': 'BOX({},{},{},{})'.format(*box), 'size': str(PAGE_SIZE), 'page': str(page),
              'format': 'json', 'crs': 'EPSG:4326', 'geometry': 'true', 'attribute': 'true'}
    url = ENDPOINT + '?' + urllib.parse.urlencode({**params, 'key': key})
    req = urllib.request.Request(url, headers={'User-Agent': 'RangseonDapsa-Seoul/1.0'})
    with urllib.request.urlopen(req, timeout=120) as response:
        body = response.read()
    if key.encode() in body:
        raise RuntimeError('Response echoes the key; refusing to store it')
    return params, body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refresh', action='store_true')
    args = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    entries = manifest.get('vworld-spbd', {}).get('responses', [])
    if args.refresh:
        key = env_key()
        if not key:
            raise SystemExit('VWORLD_KEY is empty in .env')
        SNAP.mkdir(parents=True, exist_ok=True)
        entries = []
        for i, box in enumerate(cells()):
            page = 1
            while True:
                params, body = request(key, box, page)
                r = json.loads(body)['response']
                if r['status'] not in ('OK', 'NOT_FOUND'):
                    raise RuntimeError(f"{box} page {page}: {r.get('status')} {r.get('error')}")
                name = f'cell{i:03d}-p{page}.json.gz'
                (SNAP / name).write_bytes(gzip.compress(body, mtime=0))
                entries.append({'snapshot': str((SNAP / name).relative_to(ROOT)), 'params': params,
                                'status': r['status'], 'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)})
                total_pages = int((r.get('page') or {}).get('total', 1))
                if r['status'] == 'NOT_FOUND' or page >= total_pages:
                    break
                page += 1
        manifest['vworld-spbd'] = {
            'url': ENDPOINT, 'layer': 'LT_C_SPBD 도로명주소 건물 (제공처 행정안전부)',
            'license': '브이월드 오픈API 이용약관 (재배포 조건 확인 필요)',
            'fetched_at': datetime.now(timezone.utc).isoformat(), 'note': 'Requests stored without the API key.',
            'responses': entries}
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    features = {}
    for e in entries:
        body = gzip.decompress((ROOT / e['snapshot']).read_bytes())
        assert hashlib.sha256(body).hexdigest() == e['sha256'], e['snapshot']
        r = json.loads(body)['response']
        for f in ((r.get('result') or {}).get('featureCollection') or {}).get('features', []):
            features[f['properties']['bd_mgt_sn']] = f  # same building can appear in two cells
    out = DATA / 'processed/vworld-spbd.geojson'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'type': 'FeatureCollection', 'features': list(features.values())}, ensure_ascii=False) + '\n')
    floors = [int(f['properties'].get('gro_flo_co') or 0) for f in features.values()]
    known = [n for n in floors if n > 0]
    print(f'{len(features)} buildings, floors>0: {len(known)} ({len(known) / max(1, len(floors)):.1%}), max {max(known, default=0)}')


if __name__ == '__main__':
    main()

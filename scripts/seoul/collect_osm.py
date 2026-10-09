#!/usr/bin/env python3
"""OSM snapshot around N Seoul Tower. Default reuses saved bytes; --refresh fetches again."""
import argparse
import gzip
import hashlib
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data/seoul'
MANIFEST = DATA / 'sources.json'
UA = 'RangseonDapsa-Seoul/1.0 (https://github.com/UnderCruzer/rangseon-dapsa; research snapshot)'
ANCHOR = 16474080  # relation: 남산서울타워 (Q69134)
RADIUS_M = 1500
ROAD_RADIUS_M = 2200  # extra highway ways so routes near the edge stay connected


def fetch(key, endpoint, query, refresh):
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    dst = DATA / 'snapshots' / f'{key}.json.gz'
    if key in manifest and not refresh:
        body = gzip.decompress(dst.read_bytes())
        assert hashlib.sha256(body).hexdigest() == manifest[key]['sha256'], f'Hash mismatch {dst}'
        return json.loads(body)
    request = urllib.request.Request(endpoint, data=urllib.parse.urlencode({'data': query}).encode(),
                                     headers={'User-Agent': UA})
    with urllib.request.urlopen(request, timeout=240) as response:
        body = response.read()
    obj = json.loads(body)
    if obj.get('remark'):
        raise RuntimeError(obj['remark'])
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(gzip.compress(body, mtime=0))
    manifest[key] = {'url': endpoint, 'query': query, 'license': 'ODbL-1.0',
                     'fetched_at': datetime.now(timezone.utc).isoformat(),
                     'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body),
                     'snapshot': str(dst.relative_to(ROOT))}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(key, len(body), 'bytes', flush=True)
    return obj


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--endpoint', default='https://overpass-api.de/api/interpreter')
    args = parser.parse_args()
    anchor = fetch('osm-anchor', args.endpoint,
                   f'[out:json][timeout:60];relation({ANCHOR});out center meta;', args.refresh)
    center = anchor['elements'][0]['center']
    lat, lon = center['lat'], center['lon']
    fetch('osm-area', args.endpoint,
          f'[out:json][timeout:180];(nwr(around:{RADIUS_M},{lat},{lon});'
          f'way["highway"](around:{ROAD_RADIUS_M},{lat},{lon}););out meta geom;', args.refresh)
    print('anchor', lat, lon)


if __name__ == '__main__':
    main()

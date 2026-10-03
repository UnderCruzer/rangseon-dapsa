#!/usr/bin/env python3
"""Phase 0 metadata probe only: no rendering, model inference or asset generation."""
import argparse
import gzip
import hashlib
import json
import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data/realworld'
CATALOG = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fetch', action='store_true', help='Explicitly collect fresh public metadata')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / 'sources.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    def source(key, url):
        path = OUT / (key + '.json.gz')
        if args.fetch:
            request = urllib.request.Request(url, headers={'User-Agent': 'RangseonDapsa-Phase0/1.0'})
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read(32 * 1024 * 1024 + 1)
            if len(body) > 32 * 1024 * 1024:
                raise ValueError('Metadata response exceeded 32 MiB limit')
            result = json.loads(body)
            path.write_bytes(gzip.compress(body, mtime=0))
            manifest[key] = {'url': url, 'fetched_at': datetime.now(timezone.utc).isoformat(),
                             'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body),
                             'snapshot': str(path.relative_to(ROOT)),
                             'license': 'Dataset-specific terms not yet verified; metadata probe only'}
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        else:
            if key not in manifest or not path.exists():
                raise RuntimeError('Missing snapshot; run with --fetch for initial collection')
            body = gzip.decompress(path.read_bytes())
            assert hashlib.sha256(body).hexdigest() == manifest[key]['sha256'], key
            assert manifest[key]['url'] == url, key
            result = json.loads(body)
        return result

    catalog = source('plateau-catalog', CATALOG)
    rows = [r for r in catalog['datasets'] if r.get('city_code') == '13103'
            and r['type_en'] in ('bldg', 'tran')]
    anchor = json.loads((ROOT / 'data/processed/coverage.json').read_text())['center']
    lon, lat = math.radians(anchor['lng']), math.radians(anchor['lat'])
    probes = []
    for row in rows:
        if row['format'] != '3D Tiles' or not row.get('texture'):
            continue
        tileset = source(row['id'], row['url'])
        region = tileset['root'].get('boundingVolume', {}).get('region')
        contains = None if region is None else region[0] <= lon <= region[2] and region[1] <= lat <= region[3]
        probes.append({'dataset_id': row['id'], 'root_region_contains_tower': contains,
                       'root_region_radians': region, 'asset_version': tileset['asset']['version'],
                       'coverage_verified': False,
                       'note': 'Root bounding-box inclusion does not prove individual buildings, roads or texture coverage.'})
    report = {'status': 'metadata_verified_only; user_data_approval_pending',
              'catalog_source': 'plateau-catalog', 'datasets': rows, 'probes': probes,
              'model_executed': False, 'model_output': None,
              'unverified': ['Tokyo Tower per-feature geometry and road surface coverage',
                             'dataset-specific license and acquisition dates',
                             'geodetic/vertical datum alignment with OSM',
                             'licensed real multi-view imagery for reconstruction',
                             'world-model geometry preservation and GPU execution']}
    (OUT / 'availability.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'datasets': len(rows), 'probes': probes}, ensure_ascii=False))


if __name__ == '__main__':
    main()

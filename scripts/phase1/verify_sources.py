#!/usr/bin/env python3
"""Fetch two bounded source tiles and preserve inspectable feature metadata."""
import argparse
import gzip
import hashlib
import json
import struct
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data/phase1'
POLICY = 'https://www.mlit.go.jp/plateau/site-policy/'
PACKAGE = 'https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-13103-minato-ku-2025'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fetch', action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / 'sources.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    def read(key, url):
        path = OUT / (key + '.gz')
        if args.fetch:
            with urllib.request.urlopen(url, timeout=30) as response:
                body = response.read(16 * 1024 * 1024 + 1)
            if len(body) > 16 * 1024 * 1024:
                raise ValueError('Response exceeds evidence size limit')
            path.write_bytes(gzip.compress(body, mtime=0))
            manifest[key] = {'url': url, 'fetched_at': datetime.now(timezone.utc).isoformat(),
                             'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body),
                             'snapshot': str(path.relative_to(ROOT)), 'license_url': POLICY}
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        else:
            body = gzip.decompress(path.read_bytes())
            assert hashlib.sha256(body).hexdigest() == manifest[key]['sha256']
            assert manifest[key]['url'] == url
        return body

    package = json.loads(read('dataset-metadata.json', PACKAGE))['result']
    datasets = json.loads((ROOT / 'data/realworld/availability.json').read_text())['datasets']
    results = []
    for key, tile in [('13103_bldg_lod3', 'data/data248.b3dm'), ('13103_tran_lod3', 'data/0/data898.b3dm')]:
        base = next(r['url'] for r in datasets if r['id'] == key)
        body = read(key + '.b3dm', urljoin(base, tile))
        magic, version, total, fj, fb, bj, bb = struct.unpack('<4s6I', body[:28])
        assert magic == b'b3dm' and version == 1 and total == len(body)
        props = json.loads(body[28+fj+fb:28+fj+fb+bj])
        features = [{k: v[i] for k, v in props.items() if isinstance(v, list)}
                    for i in range(len(props['gml_id']))]
        results.append({'dataset_id': key, 'tile': tile, 'source_url': urljoin(base, tile),
                        'features': features, 'count': len(features),
                        'note': 'Raw source tile properties; spatial match is not a surveyed entrance verification.'})
    report = {'dataset_title': package['title'], 'license_title': package['license_title'],
              'license_url': package['license_url'], 'source_package_url': PACKAGE,
              'samples': results, 'model_executed': False}
    (OUT / 'verified-features.json').write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
    for result in results:
        print(result['dataset_id'], result['count'], 'source objects')
    buildings = results[0]['features']
    for feature in sorted(buildings, key=lambda f: float(f.get('bldg:measuredHeight') or 0), reverse=True)[:2]:
        print({k: feature.get(k) for k in ['gml_id', 'gml:name', 'bldg:measuredHeight', '_x', '_y', '_lod']})


if __name__ == '__main__':
    main()

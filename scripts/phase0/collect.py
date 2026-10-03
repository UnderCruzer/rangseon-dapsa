#!/usr/bin/env python3
"""Fetch immutable source snapshots. Default reuses saved bytes; --refresh explicitly updates them."""
import gzip
import argparse, hashlib, json, time, urllib.request, urllib.parse
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data'
UA = 'RangseonDapsa-Phase0/1.0 (https://github.com/UnderCruzer/rangseon-dapsa; research snapshot)'
MANIFEST = DATA / 'sources.json'

def fetch(key, url, query=None, license='미확인', refresh=False):
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    dst = DATA / 'snapshots' / (key + ('.json.gz' if key=='osm-area' else '.json' if query is not None or 'json' in url or 'api.php' in url else '.html'))
    if key in manifest and not refresh:
        assert dst.exists(), f'Missing snapshot {dst}'
        assert hashlib.sha256(gzip.decompress(dst.read_bytes()) if dst.suffix=='.gz' else dst.read_bytes()).hexdigest() == manifest[key]['sha256']
        return dst
    req = urllib.request.Request(url, data=urllib.parse.urlencode({'data':query}).encode() if query else None, headers={'User-Agent':UA})
    with urllib.request.urlopen(req, timeout=180) as response:
        body = response.read()
        content_type = response.headers.get('Content-Type')
    if dst.suffix in ('.json','.gz'):
        obj = json.loads(body)
        if obj.get('remark') or obj.get('error'): raise RuntimeError(obj.get('remark') or obj['error'])
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(gzip.compress(body,mtime=0) if dst.suffix=='.gz' else body)
    manifest[key] = {'url':url, 'query':query, 'license':license, 'fetched_at':datetime.now(timezone.utc).isoformat(), 'sha256':hashlib.sha256(body).hexdigest(), 'bytes':len(body), 'content_type':content_type, 'snapshot':str(dst.relative_to(ROOT))}
    MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(key, len(body), flush=True)
    return dst

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--refresh',action='store_true'); ap.add_argument('--ids',nargs='*'); ap.add_argument('--endpoint',default='https://overpass-api.de/api/interpreter'); ap.add_argument('--stage',choices=['osm','official','wikidata'],required=True); a=ap.parse_args()
    if a.stage == 'osm':
        ep=a.endpoint
        p=fetch('osm-anchor',ep,'[out:json][timeout:60];nwr["name"="東京タワー"](35.64,139.73,35.68,139.76);out center meta;', 'ODbL-1.0',a.refresh)
        items=json.loads(p.read_text())['elements']
        anchor=next(e for e in items if e.get('tags',{}).get('man_made')=='tower')
        c=anchor.get('center',anchor); lat,lon=c['lat'],c['lon']
        around=f'(around:1500,{lat},{lon})'
        selectors=['["building"]','["building:part"]','["highway"]','["railway"="subway_entrance"]','["railway"="station"]','["natural"="tree"]','["natural"="tree_row"]','["amenity"]','["tourism"]','["shop"]','["leisure"="park"]','["historic"]','["barrier"]']
        q=f'[out:json][timeout:120];(nwr{around};way["highway"](around:2200,{lat},{lon}););out meta geom;'
        fetch('osm-area',ep,q,'ODbL-1.0',a.refresh)
    if a.stage == 'official':
        urls={
            'tower-hours':'https://en.tokyotower.co.jp/fee/',
            'park-hours':'https://www.tokyo-park.or.jp/park/siba/index.html',
            'market-hours':'https://www.azabudai-hills.com/information/index.html',
            'cafe-hours':'https://www.princehotels.co.jp/tokyo/restaurant/lepainquotidien/',
            'tower-lightup':'https://en.tokyotower.co.jp/lightup/',
            'tower-lightup-ja':'https://www.tokyotower.co.jp/lightup/index.html',
            'tower-access':'https://en.tokyotower.co.jp/access/',
            'zojoji-faq':'https://www.zojoji.or.jp/faq/',
            'zojoji-en':'https://www.zojoji.or.jp/en/',
            'toei-akabanebashi':'https://www.kotsu.metro.tokyo.jp/subway/stations/akabanebashi.html',
            'solar-method':'https://www.gml.noaa.gov/grad/solcalc/calcdetails.html',
        }
        for key,url in urls.items():
            try: fetch(key,url,license='All rights reserved; factual extraction only; do not redistribute full page',refresh=a.refresh)
            except Exception as e: print(key, 'FAILED',str(e),flush=True)
    if a.stage == 'wikidata':
        items=json.loads(gzip.decompress((DATA/'snapshots/osm-area.json.gz').read_bytes()).decode())['elements']
        ids=sorted({e.get('tags',{}).get('wikidata') for e in items if e.get('tags',{}).get('wikidata','').startswith('Q')})
        for qid in (a.ids or ids):
            if not qid[1:].isdigit(): continue
            try:
                fetch('wikidata-'+qid,f'https://www.wikidata.org/wiki/Special:EntityData/{qid}.json',license='CC0-1.0 (structured data only; linked images have independent licenses)',refresh=a.refresh)
                time.sleep(.2)
            except Exception as e: print(qid,'FAILED',str(e),flush=True)
if __name__=='__main__': main()

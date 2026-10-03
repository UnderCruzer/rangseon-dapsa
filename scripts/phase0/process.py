#!/usr/bin/env python3
"""Offline deterministic derivation. Do not edit generated CSV/JSON by hand."""
import gzip
import argparse, csv, hashlib, heapq, json, math, re
from collections import Counter, defaultdict
from pathlib import Path
from solar import solar_day
ROOT=Path(__file__).resolve().parents[2]; DATA=ROOT/'data'
FIELDS='name category lat lng opening_hours duration_min source source_url license fetched_at'.split()
CLASS_KEYS=['tourism','amenity','shop','leisure','historic','building','building:part','highway','railway','natural','barrier']
def save(path,obj):
    p=ROOT/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False,indent=2,sort_keys=True)+'\n')
def dist(a,b):
    p,q=map(math.radians,(a[0],b[0])); dp=q-p;dl=math.radians(b[1]-a[1]);return 6371008.8*2*math.asin(min(1,math.sqrt(math.sin(dp/2)**2+math.cos(p)*math.cos(q)*math.sin(dl/2)**2)))
def oid(e):return f"{e['type']}/{e['id']}"
def coord(e):
    if 'lat' in e:return [e['lat'],e['lon']], 'OSM node'
    b=e.get('bounds')
    if b:return [(b['minlat']+b['maxlat'])/2,(b['minlon']+b['maxlon'])/2], 'OSM bounds midpoint (not an entrance)'
    if 'center' in e:return [e['center']['lat'],e['center']['lon']], 'Overpass center (not an entrance)'
    return None,'미확인'
def geometry(e):
    if 'lat' in e: return {'type':'Point','coordinates':[e['lon'],e['lat']]}
    if e['type']=='way':
        pts=[[p['lon'],p['lat']] for p in e.get('geometry',[]) if p and 'lat' in p]
        if len(pts)<2:return None
        area=(e.get('tags',{}).get('area')=='yes' or any(k in e.get('tags',{}) for k in ['building','building:part','leisure']))
        return {'type':'Polygon','coordinates':[pts]} if area and pts[0]==pts[-1] and len(pts)>=4 else {'type':'LineString','coordinates':pts}
    # Preserve member rings/roles in source JSON; never flatten multipolygon holes.
    return None

def walk_graph(elements):
    graph=defaultdict(list); xy={}; omitted=Counter()
    nt={e['id']:e.get('tags',{}) for e in elements if e['type']=='node'}
    allowed={'footway','path','pedestrian','steps','living_street','residential','service','unclassified','tertiary','secondary','primary','tertiary_link','secondary_link','primary_link','track','road'}
    explicit={'yes','designated','permissive'}
    for e in elements:
        t=e.get('tags',{}); h=t.get('highway');foot=t.get('foot')
        if e['type']!='way' or not h:continue
        if h not in allowed and foot not in explicit:omitted['nonwalking_highway']+=1;continue
        if foot in {'no','private','use_sidepath'} or (t.get('access') in {'no','private','customers','permit'} and foot not in explicit):omitted['access']+=1;continue
        if t.get('area')=='yes' or t.get('indoor')=='yes' or any(k in t for k in ('access:conditional','foot:conditional','construction')):omitted['conditional_area_indoor']+=1;continue
        nodes=e.get('nodes',[]); ge=e.get('geometry',[])
        for a,b,pa,pb in zip(nodes,nodes[1:],ge,ge[1:]):
            if not pa or not pb:continue
            if any(nt.get(n,{}).get('foot') in {'no','private'} or nt.get(n,{}).get('access') in {'no','private'} or (nt.get(n,{}).get('barrier') in {'wall','fence','retaining_wall','block'} and nt.get(n,{}).get('foot') not in explicit) for n in (a,b)):continue
            xy[a]=[pa['lat'],pa['lon']];xy[b]=[pb['lat'],pb['lon']];d=dist(xy[a],xy[b])
            if t.get('oneway:foot')!='-1':graph[a].append((b,d,e['id']))
            if t.get('oneway:foot') not in {'yes','1','true'}:graph[b].append((a,d,e['id']))
    return graph,xy,dict(omitted)

def shortest(graph,start,end):
    pq=[(0,start)]; cost={start:0};prev={}
    while pq:
        d,u=heapq.heappop(pq)
        if d!=cost[u]:continue
        if u==end:
            nodes=[u];ways=[]
            while u!=start:u,w=prev[u];nodes.append(u);ways.append(w)
            return d,list(reversed(nodes)),list(reversed(ways))
        for v,length,w in graph.get(u,[]):
            n=d+length
            if n<cost.get(v,float('inf')):cost[v]=n;prev[v]=(u,w);heapq.heappush(pq,(n,v))
    return None

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--date');a=ap.parse_args()
    sources=json.loads((DATA/'sources.json').read_text())
    for k in ('osm-anchor','osm-area'):
        p=ROOT/sources[k]['snapshot'];assert hashlib.sha256(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes()).hexdigest()==sources[k]['sha256'],f'Changed snapshot {k}'
    anchor=next(e for e in json.loads((DATA/'snapshots/osm-anchor.json').read_text())['elements'] if e.get('tags',{}).get('man_made')=='tower')
    center,_=coord(anchor)
    all_e=json.loads(gzip.decompress((DATA/'snapshots/osm-area.json.gz').read_bytes()).decode())['elements']
    es=sorted(all_e,key=lambda e:(e['type'],e['id']))
    raw=[];index=[];features=[];counts=Counter();buildings=[];places=[]
    for e in es:
        t=e.get('tags',{});c,method=coord(e)
        if not t:continue
        within=c is not None and dist(center,c)<=1500
        # Core elements may straddle boundary; keep actual geometry and mark representative distance.
        if not within:continue
        cat=';'.join(f'{k}={t[k]}' for k in CLASS_KEYS if k in t)
        raw.append(dict(zip(FIELDS,[t.get('name',''),cat,e.get('lat',''),e.get('lon',''),t.get('opening_hours',''),'', 'OpenStreetMap',f'https://www.openstreetmap.org/{oid(e)}','ODbL-1.0',sources['osm-area']['fetched_at']])))
        index.append({'row':len(raw)+1,'osm_id':oid(e),'version':e.get('version'),'timestamp':e.get('timestamp')})
        for k in CLASS_KEYS:
            if k in t:counts[k+'='+t[k]]+=1
        g=geometry(e)
        if g:features.append({'type':'Feature','geometry':g,'properties':{'osm_id':oid(e),'tags':t,'source_url':f'https://www.openstreetmap.org/{oid(e)}','license':'ODbL-1.0'}})
        if 'building' in t or 'building:part' in t:buildings.append(e)
        if any(k in t for k in ('amenity','tourism','shop','leisure','historic')):
            places.append({'id':oid(e),'name':t.get('name'), 'category':cat,'lat':c[0],'lng':c[1],'coordinate_method':method,'opening_hours':t.get('opening_hours'),'official_hours':None,'rating':None,'duration_min':None,'wikidata':t.get('wikidata'),'source_url':f'https://www.openstreetmap.org/{oid(e)}','tags':t})
    with (DATA/'raw/osm.csv').open('w',newline='') as f:w=csv.DictWriter(f,fieldnames=FIELDS);w.writeheader();w.writerows(raw)
    save('data/raw/osm-row-index.json',index)
    save('data/processed/places.json',places)
    save('data/processed/features.geojson',{'type':'FeatureCollection','features':features})
    graph,xy,omitted=walk_graph(es)
    save('data/processed/walk-graph.json',{'source':'osm-area','license':'ODbL-1.0','nodes':xy,'adjacency':dict(graph),'omitted_ways':omitted,'note':'No invented connections at line intersections. Road centerline edges can stand for permitted walking when separate sidewalks are unmapped; not an all-sidewalk network. Tagged barriers/restrictions filtered; missing restrictions remain unknown.'})
    summary={'center':{'lat':center[0],'lng':center[1],'source_url':f'https://www.openstreetmap.org/{oid(anchor)}'},'core_radius_m':1500,'routing_query_radius_m':2200,'core_rule':'representative point within 1500m; full geometry retained; boundary-crossing objects may extend outside','raw_rows':len(raw),'source_elements':len(es),'places':len(places),'features':len(features),'categories':dict(counts),'buildings':{'total':len(buildings),'height_tag':sum('height' in e.get('tags',{}) for e in buildings),'levels_only':sum('height' not in e.get('tags',{}) and 'building:levels' in e.get('tags',{}) for e in buildings),'unknown_height_and_levels':sum(not any(k in e.get('tags',{}) for k in ('height','building:levels')) for e in buildings)},'walk_graph_nodes':len(xy),'walk_graph_directed_edges':sum(map(len,graph.values())),'signal_cycle_seconds':None,'terrain_elevation':None,'solar':solar_day(a.date,*center),'source_fetched_at':sources['osm-area']['fetched_at'],'snapshot_sha256':sources['osm-area']['sha256']}
    save('data/processed/coverage.json',summary)
    print(json.dumps({k:v for k,v in summary.items() if k!='categories'},ensure_ascii=False,indent=2))
if __name__=='__main__':main()

"""Conservative road-distance scenarios. Not live navigation or observed travel time."""
import gzip,json,heapq
from collections import defaultdict
from process import DATA,dist,save

def main():
    es=json.loads(gzip.decompress((DATA/'snapshots/osm-area.json.gz').read_bytes()))['elements']
    blocked=set(); no=defaultdict(set); only=defaultdict(set); restrictions=0
    for e in es:
        t=e.get('tags',{})
        if t.get('type')!='restriction' or 'motorcar' in t.get('except','').split(';'):continue
        members=e.get('members',[]);fr=[m['ref'] for m in members if m['role']=='from'];to=[m['ref'] for m in members if m['role']=='to'];via=[m for m in members if m['role']=='via']
        r=t.get('restriction:motorcar',t.get('restriction',''))
        if not r and not any('restriction' in k for k in t):continue
        restrictions+=1
        if len(via)!=1 or via[0]['type']!='node' or any('conditional' in k for k in t):blocked.update(fr);continue
        for f in fr:
            if r.startswith('only_'):only[(f,via[0]['ref'])].update(to)
            elif r.startswith('no_'):no[(f,via[0]['ref'])].update(to)
            else:blocked.add(f)
    graph=defaultdict(list);xy={};node_tags={e['id']:e.get('tags',{}) for e in es if e['type']=='node'}
    roads={'motorway','trunk','primary','secondary','tertiary','unclassified','residential','living_street','service','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link'}
    for e in es:
        t=e.get('tags',{})
        if e['type']!='way' or t.get('highway') not in roads or e['id'] in blocked:continue
        access=t.get('motorcar',t.get('motor_vehicle',t.get('vehicle',t.get('access','yes'))))
        if access not in {'yes','permissive','designated'} or t.get('area')=='yes' or any('conditional' in k for k in t):continue
        direction=t.get('oneway','yes' if t.get('junction')=='roundabout' or t.get('highway')=='motorway' else 'no')
        for a,b,pa,pb in zip(e.get('nodes',[]),e.get('nodes',[])[1:],e.get('geometry',[]),e.get('geometry',[])[1:]):
            if not pa or not pb:continue
            if any(node_tags.get(n,{}).get('barrier') in {'bollard','block','wall','fence','gate','lift_gate'} for n in (a,b)):continue
            xy[a]=[pa['lat'],pa['lon']];xy[b]=[pb['lat'],pb['lon']];d=dist(xy[a],xy[b])
            if direction!='-1':graph[a].append((b,d,e['id']))
            if direction not in {'yes','1','true'}:graph[b].append((a,d,e['id']))
    def route(start,end):
        pq=[(0,start,0)];best={(start,0):0};prev={}
        while pq:
            d,u,incoming=heapq.heappop(pq);state=(u,incoming)
            if d!=best[state]:continue
            if u==end:
                ids=[u];ways=[]
                while state in prev:
                    old,w=prev[state];ids.append(old[0]);ways.append(w);state=old
                return d,list(reversed(ids)),list(reversed(ways))
            for v,c,w in graph[u]:
                if w in no[(incoming,u)] or (only[(incoming,u)] and w not in only[(incoming,u)]):continue
                nxt=(v,w);nd=d+c
                if nd<best.get(nxt,float('inf')):best[nxt]=nd;prev[nxt]=(state,w);heapq.heappush(pq,(nd,v,w))
        return None
    trip=json.loads((DATA/'day1.json').read_text());ps={s['place_id']:s for s in trip['stops']}
    for leg in trip['legs']:
        ends=[ps[leg[k]] for k in ('from','to')];snaps=[min(graph,key=lambda n:dist([p['lat'],p['lng']],xy[n])) for p in ends];r=route(*snaps)
        alt={'mode':'taxi','distance_m':None,'duration_min':None,'kind':'추정 시나리오 / 운행 가능 보장 아님','source_snapshot':'osm-area','source_method':'scripts/phase0/taxi.py; docs/phase0/METHODS.md','assumed_speed_kmh':15,'speed_kind':'reviewable modelling parameter, not measured Tokyo traffic','restrictions_read':restrictions,'endpoint_gaps_m':[round(dist([p['lat'],p['lng']],xy[n]),1) for p,n in zip(ends,snaps)],'limitations':'No pickup/parking/queue time. Excludes tagged private access and conditional/from-via-way restrictions conservatively. Missing map restrictions, exact entrances and traffic remain unverified.'}
        if r:
            length,nodes,ways=r;alt.update(distance_m=round(length,1),duration_min=round(length/250,1),osm_node_ids=nodes,osm_way_ids=list(dict.fromkeys(ways)),geometry={'type':'LineString','coordinates':[[xy[n][1],xy[n][0]] for n in nodes]})
        leg['alternatives']['taxi']=alt
    save('data/day1.json',trip)
    print([(l['alternatives']['taxi']['distance_m'],l['alternatives']['taxi']['duration_min']) for l in trip['legs']])
if __name__=='__main__':main()

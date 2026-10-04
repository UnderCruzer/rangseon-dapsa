#!/usr/bin/env python3
"""Data-review proposal, not a bookable itinerary. All planning parameters labelled."""
import json, math
from datetime import datetime,timedelta
from process import ROOT,DATA,save,dist,shortest

SELECTION=[
 ('way/30520683','시바공원',30,'낮 공원 산책. 공원 운영 주체 자료로 상시 개방을 확인했다.','park-hours'),
 ('way/744348814','조조지',45,'본당의 공식 마감 17:30 전에 방문. 부지 24/7 태그를 본당 시간으로 사용하지 않는다.','zojoji-main-hours'),
 ('node/1145149963','Le Pain Quotidien 시바공원점',60,'공원·사찰 근처에 OSM 등록된 베이커리/카페. 운영 주체 페이지의 식사 가능 시간을 대조했다.','cafe-hours'),
 ('node/14047630601','아자부다이 힐즈 마켓',75,'식음·쇼핑 후보. 공식 마켓 시간과 OSM 태그를 대조했다. 매장별 예외는 미확인.','market-hours'),
 ('relation/4247312','도쿄타워 MAIN DECK',90,'일몰 뒤 전망대 방문을 마지막에 배치. 입장 대기와 당일 점등 예외는 별도 확인.','tower-main-hours'),
]

def main():
    cov=json.loads((DATA/'processed/coverage.json').read_text());places={p['id']:p for p in json.loads((DATA/'processed/places.json').read_text())}
    official=json.loads((DATA/'official-facts.json').read_text());facts={f['id']:f for f in official['hours']}
    g=json.loads((DATA/'processed/walk-graph.json').read_text());xy={int(k):v for k,v in g['nodes'].items()};graph={int(k):v for k,v in g['adjacency'].items()}
    stops=[];matches=[]
    for oid,label,duration,reason,fid in SELECTION:
        p=places[oid];f=facts[fid]
        comparison=('scope_mismatch' if oid=='way/744348814' else 'osm_missing' if not p['opening_hours'] else 'matched_general_hours')
        matches.append({'osm_id':oid,'name':p['name'],'osm_opening_hours':p['opening_hours'],'official_fact':fid,'official_value':f['value'],'status':comparison,'source_url':f['source_url'],'checked_at':f['fetched_at'],'note':'Date-specific exceptions not verified. Original tag preserved.'})
        c=[p['lat'],p['lng']];near=min(graph,key=lambda n:dist(c,xy[n]))
        stops.append({'order':len(stops)+1,'place_id':oid,'name':p['name'],'display_name_ko':label,'category':p['category'],'lat':p['lat'],'lng':p['lng'],'coordinate_method':p['coordinate_method'],'source_url':p['source_url'],'source_snapshot':'osm-area','opening_hours_raw':p['opening_hours'],'official_hours':f,'hours_comparison':comparison,'visit_at':None,'departure_at':None,'period':'after_sunset' if oid=='relation/4247312' else 'daylight_preferred','duration_min':duration,'duration_kind':'planning_proposal_not_observed','duration_source':'scripts/phase0/plan.py: SELECTION; assistant proposal for user review','reason':reason,'rating':None,'snap':{'node_id':near,'distance_m':round(dist(c,xy[near]),1),'status':'미확인: nearest mapped walk node, not verified entrance','source_url':f'https://www.openstreetmap.org/node/{near}'}})
    legs=[]
    for a,b in zip(stops,stops[1:]):
        path=shortest(graph,a['snap']['node_id'],b['snap']['node_id'])
        if path:
            length,nodes,ways=path
            leg={'from':a['place_id'],'to':b['place_id'],'mode':'walk','distance_m':round(length,1),'distance_kind':'calculated_on_OSM_graph','duration_min':round(length/(4500/60),1),'duration_kind':'추정','method':'Dijkstra, haversine edge lengths; 4.5 km/h proposed walking-speed parameter, excludes signals/stops/entrance connectors','assumption_source':'docs/phase0/METHODS.md#보행','osm_node_ids':nodes,'osm_way_ids':list(dict.fromkeys(ways)),'geometry':{'type':'LineString','coordinates':[[xy[n][1],xy[n][0]] for n in nodes]},'source_snapshot':'osm-area','endpoint_gaps_m':[a['snap']['distance_m'],b['snap']['distance_m']],'door_to_door_verified':False}
        else:leg={'from':a['place_id'],'to':b['place_id'],'mode':'walk','distance_m':None,'duration_min':None,'status':'미확인: 보행 그래프 연결 없음'}
        leg['alternatives']={'subway':{'duration_min':None,'distance_m':None,'status':'미확인: 공식 역 순서만 확인, 여행 날짜/시각 및 운행시간 미확인; 짧은 Day 1 동선에 억지로 넣지 않음','source_url':official['station_sequence']['source_url']},'taxi':{'duration_min':None,'distance_m':None,'status':'미확인: 차량 회전 제한 검증 전. 보행 거리를 택시 거리로 사용하지 않음'}}
        legs.append(leg)
    solar=cov['solar'];schedule_status='미확인: 여행 날짜 필요'
    # If supplied, propose start 6h before sunset and gate night visit after sunset.
    # The 6h offset and 20min night margin are planning choices, never venue facts.
    if solar['sunset']:
        sunset=datetime.fromisoformat(solar['sunset']);at=sunset-timedelta(hours=6);schedule_status='계획 제안: 영업 일반시간만 대조, 특별 휴관/대기시간 미확인'
        for i,s in enumerate(stops):
            if s['period']=='after_sunset':at=max(at,sunset+timedelta(minutes=20))
            s['visit_at']=at.isoformat();at+=timedelta(minutes=s['duration_min']);s['departure_at']=at.isoformat()
            if i<len(legs):
                if legs[i]['duration_min'] is None:schedule_status='미확인: 연결 안 된 이동 구간';break
                at+=timedelta(minutes=math.ceil(legs[i]['duration_min']))
    result={'schema_version':1,'phase':0,'approval':'pending_user_data_approval','status':'proposal_requires_date_and_endpoint_review','date':solar['date'],'timezone':'Asia/Tokyo','solar':solar,'schedule_status':schedule_status,'schedule_rules':{'proposed_start':'sunset - 6h','tower_arrival':'max(previous departure + walk estimate, sunset + 20min)','provenance':'planning proposal, not observed data','must_validate':['temple main hall departure <= 17:30','market visit within general 10:00-20:00; shop-specific exceptions unknown','tower admission before 22:30 and departure <= 23:00','holiday/temporary closure and exact-date light-up calendar']} ,'stops':stops,'legs':legs,'totals':{'network_distance_m':round(sum(l.get('distance_m') or 0 for l in legs),1),'estimated_walking_min':round(sum(l.get('duration_min') or 0 for l in legs),1),'proposed_stay_min':sum(s['duration_min'] for s in stops),'door_to_door_distance_m':None,'whole_day_duration_min':None,'note':'Only solved network segments summed; no connectors, queueing, traffic-signal delay or sunset waiting.'},'tower_lighting':official['tower_lighting'],'selection_reason':'도보권 공원 → 사찰 → 식사 → 마켓 → 야경. 사찰을 낮에 두고 타워 재방문 대신 야간 1회 방문으로 구성. 맛집 평점·인기도는 판단 근거로 사용하지 않음.','missing':['travel date','date-specific illumination calendar','verified entrance connectors','holiday exceptions','subway durations','taxi road routing/turn restrictions','most building heights','signal phases','image licenses for places without Commons linkage'],'source_manifest':'data/sources.json'}
    save('data/day1.json',result);save('data/processed/hours-checks.json',matches)
    print(json.dumps(result['totals'],ensure_ascii=False));print([(s['name'],s['snap']['distance_m']) for s in stops])
if __name__=='__main__':main()

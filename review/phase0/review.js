const $=id=>document.getElementById(id);
const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el;};
function link(url,label){const el=text('a',label);if(/^https?:\/\//.test(url)){el.href=url;el.target='_blank';el.rel='noopener noreferrer';}return el;}
function csv(input){const out=[];let row=[],cell='',quoted=false;for(let i=0;i<input.length;i++){let c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){out.push(row);row=[];}}else cell+=c;}if(cell||row.length){row.push(cell);out.push(row);}return out;}
async function get(p){const r=await fetch(p);if(!r.ok)throw Error(`${p}: ${r.status}`);return r.json();}
try{
const [coverage,trip,checks,facts,images,response]=await Promise.all([get('/data/processed/coverage.json'),get('/data/day1.json'),get('/data/processed/hours-checks.json'),get('/data/official-facts.json'),get('/data/processed/wikidata.json'),fetch('/data/raw/osm.csv')]);
if(!response.ok)throw Error('CSV 로딩 실패');const [columns,...rows]=csv(await response.text());
for(const [label,n] of [['원본 행',coverage.raw_rows],['건물·부속 객체',coverage.buildings.total],['높이·층수 미확인',coverage.buildings.unknown_height_and_levels],['지하철 출입구',coverage.categories['railway=subway_entrance']]]){const d=document.createElement('div');d.append(text('b',n.toLocaleString()),text('span',label));$('summary').append(d);}
$('gaps').textContent=`여행 날짜 ${trip.date??'미확인'} · 일몰 ${trip.solar.sunset??'미확인'} · 신호 주기/지표 고도 미확인 · 건물 높이가 없으면 임의 보정하지 않습니다. 수집 시각 ${coverage.source_fetched_at}`;
$('route-summary').textContent=`보행 네트워크 ${(trip.totals.network_distance_m/1000).toFixed(2)}km / 약 ${trip.totals.estimated_walking_min}분(4.5km/h 가정). 출입구 연결·신호대기 제외. 체류 ${trip.totals.proposed_stay_min}분은 계획 제안입니다.`;
for(const s of trip.stops){const li=document.createElement('li');li.append(link(s.source_url,s.name),text('span',` — ${s.display_name_ko} · ${s.duration_min}분 체류 제안 · ${s.period==='after_sunset'?'일몰 이후':'낮 우선'}`),text('div',s.reason),text('small',`출입구 미확인 연결 거리 ${s.snap.distance_m}m · ${s.coordinate_method}`));$('stops').append(li);}
for(const c of checks){const p=document.createElement('p');p.append(text('b',c.name+' '),text('span',`OSM ${c.osm_opening_hours??'미확인'} → 공식 ${c.official_value} · ${c.status} `),link(c.source_url,'출처'));$('facts').append(p);} $('facts').append(text('pre',JSON.stringify(facts.tower_lighting,null,2)));
for(const r of images){const p=document.createElement('p');p.append(link(r.source_url,r.wikidata));for(const i of r.images)p.append(text('span',' · '),link(i.source_url,i.filename),text('span',` · ${i.license??'라이선스 미확인'}`));if(!r.images.length)p.append(text('span',' · 이미지 미확인'));$('images').append(p);}
const tr=document.createElement('tr');columns.forEach(v=>tr.append(text('th',v)));$('head').append(tr);
let page=0,filtered=rows;const size=100;
function render(){const frag=document.createDocumentFragment();for(const row of filtered.slice(page*size,(page+1)*size)){const tr=document.createElement('tr');row.forEach((v,i)=>{const td=text('td',v||'미확인');td.title=v||'미확인';if(!v)td.className='missing';if(columns[i]==='source_url'&&v)td.replaceChildren(link(v,v));tr.append(td);});frag.append(tr);} $('body').replaceChildren(frag);$('count').textContent=`${filtered.length.toLocaleString()}행 · ${page+1} / ${Math.max(1,Math.ceil(filtered.length/size))} 페이지`;$('prev').disabled=!page;$('next').disabled=(page+1)*size>=filtered.length;}
function filter(){const q=$('q').value.toLowerCase(),category=$('filter').value;filtered=rows.filter(r=>(!q||r.join(' ').toLowerCase().includes(q))&&(!category||r[1].includes(category)));page=0;render();}
$('q').oninput=filter;$('filter').onchange=filter;$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};render();
}catch(e){$('error').textContent='검토 데이터를 불러오지 못했습니다. '+e.message;}

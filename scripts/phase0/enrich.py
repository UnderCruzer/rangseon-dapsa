#!/usr/bin/env python3
"""Read only the downloaded Wikidata statements; query each linked Commons file's own license."""
import json, urllib.parse, time
from pathlib import Path
from collect import fetch, ROOT, DATA

def main():
    rows=[]
    for p in sorted((DATA/'snapshots').glob('wikidata-*.json')):
        for q,e in json.loads(p.read_text()).get('entities',{}).items():
            def values(prop):return [c['mainsnak']['datavalue']['value'] for c in e.get('claims',{}).get(prop,[]) if c.get('rank')!='deprecated' and 'datavalue' in c.get('mainsnak',{})]
            row={'wikidata':q,'source_url':f'https://www.wikidata.org/wiki/{q}','license':'CC0-1.0 (structured statements only)','official_sites':values('P856'),'images':[]}
            for i,name in enumerate(values('P18')):
                url='https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode({'action':'query','format':'json','prop':'imageinfo','iiprop':'url|extmetadata','titles':'File:'+name})
                image={'filename':name,'source_url':'https://commons.wikimedia.org/wiki/File:'+urllib.parse.quote(name.replace(' ','_')),'license':None,'artist':None,'license_url':None,'image_url':None,'status':'미확인'}
                try:
                    path=fetch(f'commons-{q}-{i}',url,license='File metadata; see each image license')
                    pages=json.loads(path.read_text())['query']['pages']
                    info=next(v['imageinfo'][0] for v in pages.values() if v.get('imageinfo'))
                    md=info.get('extmetadata',{});get=lambda k:md.get(k,{}).get('value')
                    image.update(license=get('LicenseShortName'),artist=get('Artist'),license_url=get('LicenseUrl'),image_url=info.get('url'),credit=get('Credit'),usage_terms=get('UsageTerms'),status='metadata_verified' if get('LicenseShortName') and get('LicenseUrl') else '미확인')
                except Exception as ex:image['error']=str(ex)
                row['images'].append(image);time.sleep(.3)
            rows.append(row)
    (DATA/'processed/wikidata.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':main()

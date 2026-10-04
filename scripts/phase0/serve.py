#!/usr/bin/env python3
"""Local read-only Phase 0 viewer. Never serves .env, source HTML snapshots or the app."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote,urlsplit
ROOT=Path(__file__).resolve().parents[2]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def do_GET(self):
        path=unquote(urlsplit(self.path).path)
        if path=='/':self.send_response(302);self.send_header('Location','/review/phase0/');self.end_headers();return
        target=(ROOT/path.lstrip('/')).resolve()
        if target.is_dir():target=target/'index.html'
        permitted=any(target.is_relative_to(ROOT/p) for p in ('review/phase0','data'))
        if not permitted or target.suffix not in ('.html','.js','.csv','.json','.geojson','.gz') or ('snapshots' in target.parts and target.suffix=='.html'):
            self.send_error(404);return
        super().do_GET()
    def do_HEAD(self):self.send_error(405)
print('Phase 0 review: http://127.0.0.1:8791/review/phase0/',flush=True)
ThreadingHTTPServer(('127.0.0.1',8791),Handler).serve_forever()

#!/usr/bin/env python3
"""Read-only localhost viewer; no app secrets or write endpoints."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
ALLOWED = ('review/phase0', 'review/phase1', 'data')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == '/':
            self.send_response(302)
            self.send_header('Location', '/review/phase1/')
            self.end_headers()
            return
        target = (ROOT / unquote(urlsplit(self.path).path).lstrip('/')).resolve()
        if target.is_dir():
            target = target / 'index.html'
        if (not any(target.is_relative_to(ROOT / p) for p in ALLOWED)
                or not target.is_file()
                or target.suffix not in ('.html', '.css', '.js', '.json', '.csv', '.geojson', '.gz')
                or ('snapshots' in target.parts and target.suffix == '.html')):
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        self.send_error(405)


if __name__ == '__main__':
    print('3D review: http://127.0.0.1:8792/review/phase1/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8792), Handler).serve_forever()

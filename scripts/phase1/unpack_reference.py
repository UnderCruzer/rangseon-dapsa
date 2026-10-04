#!/usr/bin/env python3
"""Unpack a viewer capture into traceable candidate model inputs; no inference."""
import argparse
import base64
import hashlib
import json
import struct
from pathlib import Path


def png(value, size):
    if not isinstance(value, str) or not value.startswith('data:image/png;base64,'):
        raise ValueError('Expected PNG data URL')
    body = base64.b64decode(value.split(',', 1)[1], validate=True)
    if len(body) < 24 or body[:8] != b'\x89PNG\r\n\x1a\n' or body[12:16] != b'IHDR':
        raise ValueError('Invalid PNG header')
    if struct.unpack('>II', body[16:24]) != (size['width'], size['height']):
        raise ValueError('Capture dimensions do not match manifest')
    return body


def unpack(source, output):
    data = json.loads(source.read_text())
    if data.get('schema_version') != 1 or data.get('kind') != 'rendered_reference_not_observed_photo':
        raise ValueError('Unsupported reference schema')
    if data.get('model_executed') is not False:
        raise ValueError('Input capture must not claim inference')
    if not data.get('camera') or not data.get('datasets'):
        raise ValueError('Missing camera or provenance')
    images = {name: png(data.pop(key), data['viewport']) for name, key in [('reference.png', 'rgb_png'), ('edge.png', 'edge_png')]}
    output.mkdir(parents=True, exist_ok=False)
    for name, body in images.items():
        (output / name).write_bytes(body)
    data['files'] = {name: {'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)} for name, body in images.items()}
    data['input_capture_sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    data['execution_status'] = 'not_run; single-frame reference only, not a video control sequence'
    (output / 'manifest.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('capture', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    unpack(args.capture, args.output)
    print('Reference + edge PNG and provenance saved. No world model executed.')

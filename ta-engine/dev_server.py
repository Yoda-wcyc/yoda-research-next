# -*- coding: utf-8 -*-
r"""本機跑引擎（給 Next 網站版開發用）：
    $env:JWT_SECRET = '<跟 Next dev 同一個值>'
    python "G:\Yoda x Claude\_deploy\yoda-research-next\ta-engine\dev_server.py"            # http://127.0.0.1:8790/api/engine
    python "...\dev_server.py" --port 8791
沒設 JWT_SECRET 時用 'local-dev-only'（只綁 127.0.0.1），Next dev 那邊也要設成同一個值。"""
import os, sys, argparse, importlib.util
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('engine_api', os.path.join(HERE, 'api', 'engine.py'))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8790)
    a = ap.parse_args()
    if not os.environ.get('JWT_SECRET'):
        os.environ['JWT_SECRET'] = 'local-dev-only'
        print('JWT_SECRET 沒設，本機用 local-dev-only')
    print('ta-engine on http://127.0.0.1:%d/api/engine' % a.port, flush=True)
    ThreadingHTTPServer(('127.0.0.1', a.port), api.handler).serve_forever()

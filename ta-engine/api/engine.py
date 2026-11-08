# -*- coding: utf-8 -*-
"""Vercel Python 函式入口：GET /api/engine?symbol=2330&tf=D（tf＝1H／4H／D／W）
必帶 header X-TA-Engine-Key＝HMAC-SHA256(JWT_SECRET, "ta-engine") hex；契約見 docs/ta-engine-contract.md。"""
import os, sys, json
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import ta_engine as E


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'private, no-store')      # 不讓 CDN 快取（資料只給帶金鑰的伺服器）
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(*E.handle(self.path, self.headers.get('X-TA-Engine-Key'), os.environ.get('JWT_SECRET')))

    def do_POST(self):
        self._send(405, {'ok': False, 'error': {'code': 'method', 'message': 'GET only'}})

    def log_message(self, *a):          # 不把查詢印進 log
        pass

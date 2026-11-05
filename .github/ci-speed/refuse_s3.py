#!/usr/bin/env python3
"""Local S3 stub that refuses every key in DeleteObjects, as S3 does for a denied key."""
import http.server, re, sys, urllib.parse
OBJ = sys.argv[1].split(',')
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, body=b'', code=200):
        self.send_response(code); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_PUT(self):
        self.rfile.read(int(self.headers.get('Content-Length', 0))); self.reply()
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if 'list-type' in q:
            p = q.get('prefix', [''])[0]; keys = [k for k in OBJ if k.startswith(p)]
            c = ''.join(f'<Contents><Key>{k}</Key></Contents>' for k in keys)
            self.reply(f'<ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>{len(keys)}</KeyCount>{c}</ListBucketResult>'.encode())
        else: self.reply(b'app/index.html\n')
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode()
        e = ''.join(f'<Error><Key>{k}</Key><Code>AccessDenied</Code><Message>denied</Message></Error>' for k in re.findall(r'<Key>(.*?)</Key>', body))
        self.reply(f'<DeleteResult>{e}</DeleteResult>'.encode())
http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()

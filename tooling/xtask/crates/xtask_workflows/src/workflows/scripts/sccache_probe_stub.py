"""Temporary probe backend. Modes: slow:<s>, status:<code>, hang, proxy:<s> (forwards to the real endpoint after a delay)."""
import http.client, http.server, socketserver, sys, time, urllib.parse

PORT = int(sys.argv[1])
MODE = sys.argv[2]
UP = urllib.parse.urlsplit(sys.argv[3]) if len(sys.argv) > 3 else None
MS = b'<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/probe/</D:href><D:propstat><D:prop><D:displayname>probe</D:displayname><D:getlastmodified>Wed, 04 Nov 2026 19:00:00 GMT</D:getlastmodified><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>'


class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def handle_any(self):
        n = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(n) if n else b""
        if MODE == "hang":
            time.sleep(3600)
        if MODE.startswith(("slow:", "proxy:")):
            time.sleep(float(MODE.split(":")[1]))
        if MODE.startswith("proxy:"):
            c = http.client.HTTPSConnection(UP.hostname, UP.port or 443, timeout=60)
            hdrs = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "connection")}
            c.request(self.command, self.path, body, hdrs)
            r = c.getresponse()
            data = r.read()
            self.send_response(r.status)
            for k, v in r.getheaders():
                if k.lower() not in ("connection", "transfer-encoding", "content-length"):
                    self.send_header(k, v)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        code = {"GET": 404, "HEAD": 404, "PUT": 201, "MKCOL": 201, "PROPFIND": 207}.get(self.command, 200)
        data = MS if self.command == "PROPFIND" else b""
        if MODE.startswith("status:"):
            code = int(MODE[7:])
        self.send_response(code)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_HEAD = do_PUT = do_MKCOL = do_PROPFIND = do_DELETE = handle_any

    def log_message(self, *a):
        pass


class T(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


T(("127.0.0.1", PORT), H).serve_forever()

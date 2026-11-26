# A stand-in for Firecracker's MMDS v2 in the NixOS test: a session token from
# PUT /latest/api/token, then GET <path> answers /var/lib/test-mmds<path>.json
# for that token with `Accept: application/json`, or 404.
import http.server
import pathlib

TOKEN = "test-session-token"
ROOT = pathlib.Path("/var/lib/test-mmds")


class Mmds(http.server.BaseHTTPRequestHandler):
    def answer(self, status, body=b""):
        self.send_response(status)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PUT(self):
        if self.path != "/latest/api/token" or not self.headers.get("X-metadata-token-ttl-seconds"):
            return self.answer(400)
        self.answer(200, TOKEN.encode())

    def do_GET(self):
        if self.headers.get("X-metadata-token") != TOKEN:
            return self.answer(401)
        if self.headers.get("Accept") != "application/json":
            return self.answer(406)
        document = ROOT / (self.path.strip("/") + ".json")
        if not document.is_file():
            return self.answer(404)
        self.answer(200, document.read_bytes())


http.server.ThreadingHTTPServer(("169.254.169.254", 80), Mmds).serve_forever()

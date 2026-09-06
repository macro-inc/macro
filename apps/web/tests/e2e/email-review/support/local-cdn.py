from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.request, urllib.parse, urllib.error

class Handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length,Content-Type')

    def do_HEAD(self):
        self.respond(False)

    def do_GET(self):
        self.respond(True)

    def respond(self, body):
        path = urllib.parse.urlsplit(self.path).path
        bucket = 'static-file-storage' if path.startswith('/file/') else 'macro-email-attachments' if path.startswith('/temp/') else 'doc-storage'
        try:
            with urllib.request.urlopen('http://localhost:24706/' + bucket + path) as r:
                data = r.read()
                self.send_response(r.status)
                self.cors()
                self.send_header('Content-Type', r.headers.get('Content-Type', 'application/octet-stream'))
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                if body:
                    self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.cors()
            self.end_headers()

    def log_message(self, *args):
        pass
print('Local CDN on 127.0.0.1:8100 serves real LocalStack objects', flush=True)
ThreadingHTTPServer(('127.0.0.1', 8100), Handler).serve_forever()

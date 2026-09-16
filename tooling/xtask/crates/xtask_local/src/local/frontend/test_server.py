import http.server
import os
import sys


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(
            (os.environ["VITE_LOCAL_BACKEND_ORIGIN"] + "\n" + os.getcwd()).encode()
        )


http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()

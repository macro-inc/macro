"""A smart-HTTP git server for the agent VM test.

Serves /srv/git through git http-backend on 127.0.0.1:8080, only with the
agent's Basic credentials, and appends each request's traceparent header to
/srv/git/traceparents.
"""
import base64
import http.server
import os
import subprocess

ROOT = '/srv/git'
AUTHORIZATION = 'Basic ' + base64.b64encode(b'agent:test-token').decode()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve_git()

    def do_POST(self):
        self.serve_git()

    def serve_git(self):
        if self.headers.get('Authorization') != AUTHORIZATION:
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Basic realm="workspace"')
            self.end_headers()
            return
        with open(os.path.join(ROOT, 'traceparents'), 'a') as log:
            log.write(f"{self.headers.get('traceparent')}\n")
        path, _, query = self.path.partition('?')
        environment = {
            **os.environ,
            'GIT_PROJECT_ROOT': ROOT,
            'GIT_HTTP_EXPORT_ALL': '1',
            'PATH_INFO': path,
            'QUERY_STRING': query,
            'REQUEST_METHOD': self.command,
            'CONTENT_TYPE': self.headers.get('Content-Type', ''),
            'REMOTE_USER': 'brain',
        }
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        output = subprocess.run(['git', 'http-backend'], input=body, env=environment,
                                capture_output=True, check=True).stdout
        headers, content = output.split(b'\r\n\r\n', 1)
        self.send_response(200)
        for header in headers.decode().split('\r\n'):
            key, value = header.split(':', 1)
            self.send_header(key, value.strip())
        self.end_headers()
        self.wfile.write(content)


http.server.ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever()

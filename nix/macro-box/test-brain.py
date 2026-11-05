"""Exercise first clone, retry, identity, credential scope and authenticated push."""
import base64
import http.server
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest


FILES = Path(__file__).parent / 'files'


class BrainTest(unittest.TestCase):
    def test_clone_and_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            remote = root / 'repo.git'
            subprocess.run(['git', 'init', '--bare', str(remote)], check=True)
            requests = []
            authorization = 'Basic ' + base64.b64encode(b'brain:test-token').decode()

            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.serve_git()

                def do_POST(self):
                    self.serve_git()

                def log_message(self, *args):
                    pass

                def serve_git(self):
                    if self.headers.get('Authorization') != authorization:
                        self.send_response(401)
                        self.send_header('WWW-Authenticate', 'Basic realm="workspace"')
                        self.end_headers()
                        return
                    requests.append(self.path)
                    path, _, query = self.path.partition('?')
                    env = {
                        **os.environ,
                        'GIT_PROJECT_ROOT': str(root),
                        'GIT_HTTP_EXPORT_ALL': '1',
                        'PATH_INFO': path,
                        'QUERY_STRING': query,
                        'REQUEST_METHOD': self.command,
                        'CONTENT_TYPE': self.headers.get('Content-Type', ''),
                        'REMOTE_USER': 'brain',
                    }
                    data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                    output = subprocess.run(['git', 'http-backend'], input=data,
                                            env=env, capture_output=True, check=True).stdout
                    headers, body = output.split(b'\r\n\r\n', 1)
                    self.send_response(200)
                    for header in headers.decode().split('\r\n'):
                        key, value = header.split(':', 1)
                        self.send_header(key, value.strip())
                    self.end_headers()
                    self.wfile.write(body)

            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                home = root / 'home'
                home.mkdir()
                helper = FILES / 'usr/lib/macro-box/git-credential-brain'
                start = root / 'start'
                start.write_text((FILES / 'usr/lib/macro-box/start-brain').read_text()
                                 .replace('/usr/lib/macro-box/git-credential-brain', str(helper))
                                 .replace('exec /opt/macro/brain run', 'printf started > "$HOME/started"'))
                env = {
                    **os.environ,
                    'HOME': str(home),
                    'BRAIN_WORKSPACE': str(home / 'workspace'),
                    'MACRO_REPO_URL': f'http://127.0.0.1:{server.server_port}/repo.git',
                    'MACRO_REPO_TOKEN': 'test-token',
                    'GIT_AUTHOR_NAME': 'Test Agent',
                    'GIT_AUTHOR_EMAIL': 'agent@example.com',
                    'GIT_CONFIG_NOSYSTEM': '1',
                }
                # A failed clone must leave no workspace and be retryable.
                failed = {**env, 'MACRO_REPO_TOKEN': 'wrong-token'}
                result = subprocess.run(['bash', str(start)], env=failed, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((home / 'workspace').exists())
                self.assertEqual(list(home.glob('.workspace-clone.*')), [])
                subprocess.run(['bash', str(start)], env=env, check=True)
                workspace = home / 'workspace'
                self.assertTrue((home / 'started').exists())
                config = (workspace / '.git/config').read_text()
                self.assertNotIn('test-token', config)
                self.assertIn('Test Agent', config)
                self.assertIn('agent@example.com', config)
                (workspace / 'memory').write_text('remember this')
                subprocess.run(['git', '-C', str(workspace), 'add', '.'], env=env, check=True)
                subprocess.run(['git', '-C', str(workspace), 'commit', '-m', 'remember'], env=env, check=True)
                subprocess.run(['git', '-C', str(workspace), 'push', 'origin', 'HEAD'], env=env, check=True)
                subprocess.run(['bash', str(start)], env=env, check=True)
                self.assertEqual((workspace / 'memory').read_text(), 'remember this')
                self.assertEqual(config, (workspace / '.git/config').read_text())
                self.assertTrue(any('git-receive-pack' in req for req in requests))
                # A request for another repo must not get a token.
                result = subprocess.run(['bash', str(helper), 'get'], env=env,
                                        input='protocol=http\nhost=other.invalid\npath=repo.git\n\n',
                                        capture_output=True, text=True, check=True)
                self.assertEqual(result.stdout, '')
            finally:
                server.shutdown()
                thread.join()
                server.server_close()


if __name__ == '__main__':
    unittest.main()

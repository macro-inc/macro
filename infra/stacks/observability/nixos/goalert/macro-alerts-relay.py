"""Forward GoAlert webhooks to the Macro Alerts channel.

GoAlert is the only sender: Grafana and Datadog alert GoAlert, whose escalation
policies post each alert, acknowledgement and close here. Macro's channel webhook
takes `{"content": ...}` and a bot-token header; GoAlert cannot set headers, so it
posts here over loopback and the token stays in this one service. Each request is
forwarded once; GoAlert owns retries.
"""
import json
import logging
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.request

CREDENTIALS = Path(os.environ['CREDENTIALS_DIRECTORY'])
WEBHOOK_URL = (CREDENTIALS / 'macro_alerts_webhook_url').read_text()
BOT_TOKEN = (CREDENTIALS / 'macro_alerts_bot_token').read_text()
# GoAlert abandons a webhook after three seconds.
FORWARD_TIMEOUT_SECONDS = 2.5
MAX_BODY_BYTES = 256 * 1024
MAX_CONTENT_CHARS = 4000
MAX_DETAILS_CHARS = 1500


def service_prefix(service: str) -> str:
    """`Notify` only posts to the channel; every other service pages."""
    marker = '🔔' if 'Notify' in service else '🚨 PAGE'
    return f"{marker} [{service}]" if service else marker


def goalert_content(payload: dict) -> str | None:
    kind = payload.get('Type')
    link = payload.get('GoAlertURL', '')
    service = payload.get('ServiceName', '')
    if kind == 'Alert':
        details = payload.get('Details', '').strip()
        if len(details) > MAX_DETAILS_CHARS:
            details = details[:MAX_DETAILS_CHARS].rstrip() + '\n…'
        lines = [f"{service_prefix(service)} {payload.get('Summary', '')}"]
        if details:
            lines.append(details)
        lines.append(f"Acknowledge: {link}")
        return '\n\n'.join(lines)
    if kind == 'AlertStatus':
        return f"{payload.get('LogEntry', '')}: {payload.get('Summary', '')}\n{link}"
    if kind == 'AlertBundle':
        return f"{service_prefix(service)} {payload.get('Count')} alerts\nAcknowledge: {link}"
    if kind == 'AlertStatusBundle':
        return f"{payload.get('LogEntry', '')} ({payload.get('Count')} alerts)\n{link}"
    if kind == 'ScheduleOnCallUsers':
        names = ', '.join(user.get('Name', '') for user in payload.get('Users', []))
        return f"On call for {payload.get('ScheduleName', '')}: {names or 'nobody'}\n{payload.get('ScheduleURL', '')}"
    if kind in ('Test', 'Verification'):
        return f"GoAlert {kind.lower()} message for the Macro Alerts webhook."
    return None


class Relay(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get('Content-Length', '0'))
        if self.path != '/goalert':
            self.send_error(404)
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_error(400)
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self.send_error(400)
            return
        content = goalert_content(payload) if isinstance(payload, dict) else None
        if content is None:
            logging.warning('unrecognised %s payload', self.path)
            self.send_error(422)
            return
        request = urllib.request.Request(
            WEBHOOK_URL,
            data=json.dumps({'content': content[:MAX_CONTENT_CHARS]}).encode(),
            headers={'Content-Type': 'application/json', 'x-macro-channel-bot-token': BOT_TOKEN},
            method='POST',
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=FORWARD_TIMEOUT_SECONDS) as response:
                status = response.status
        except OSError as error:
            logging.warning(
                'forward source=%s outcome=failed elapsed_ms=%d error=%s',
                self.path, (time.monotonic() - started) * 1000, error,
            )
            self.send_error(502)
            return
        logging.info(
            'forward source=%s status=%d elapsed_ms=%d',
            self.path, status, (time.monotonic() - started) * 1000,
        )
        self.send_response(204 if 200 <= status < 300 else 502)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        # Request lines carry no secrets, but errors are logged explicitly above.
        pass


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    ThreadingHTTPServer(('127.0.0.1', 8090), Relay).serve_forever()

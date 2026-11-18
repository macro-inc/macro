"""Forward GoAlert webhooks to the Macro Alerts channel.

GoAlert is the only sender: Grafana and Datadog alert GoAlert, whose escalation
policies post each alert, acknowledgement and close here. Macro's channel webhook
takes `{"content": ...}` and a bot-token header; GoAlert cannot set headers, so it
posts here over loopback and the token stays in this one service. Each request is
forwarded once; GoAlert owns retries.
"""
import json
import logging
import re
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import urllib.request

# GoAlert abandons a webhook after three seconds.
FORWARD_TIMEOUT_SECONDS = 2.5
MAX_BODY_BYTES = 256 * 1024
MAX_CONTENT_CHARS = 4000
MAX_DESCRIPTION_CHARS = 300

# Datadog titles start with bracketed tags: `[P3] [Re-Triggered on {host:x}] [PROD] Title`.
DATADOG_TAG = re.compile(r'^\s*\[([^\]]*)\]\s*')
SCOPE = re.compile(r'on \{(.+)\}')
# Datadog's state line, from `alertMessage()` in infra/stacks/monitoring/notify.ts.
DATADOG_STATE = re.compile(r'^(🔴|🟠|✅)\s*(CRITICAL|WARNING|RECOVERED):\s*(.*)$')
GRAFANA_ROW = re.compile(r'^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$')
# `macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com` -> `macro-db-prod`.
AWS_HOSTNAME = re.compile(r'\b([a-z0-9-]+)\.[a-z0-9.-]+\.amazonaws\.com\b')
LINK_LINE = re.compile(r'^(Runbook|Dashboard|Metric Graph|Source):\s*(https?://\S+)')


def short_scope(scope: str) -> str:
    """`host:macro-db-prod.abc.us-east-1.rds.amazonaws.com` -> `macro-db-prod`."""
    values = [part.split(':', 1)[-1] for part in scope.split(',')]
    return ', '.join(v.split('.', 1)[0] if '.amazonaws.com' in v else v for v in values)


def datadog_title(summary: str) -> tuple[str, str]:
    """The title without Datadog's bracketed tags, and the group it fired on."""
    scope = ''
    while (match := DATADOG_TAG.match(summary)):
        if (on := SCOPE.search(match.group(1))):
            scope = short_scope(on.group(1))
        summary = summary[match.end():]
    return summary.strip(), scope


def first_sentences(text: str) -> str:
    text = AWS_HOSTNAME.sub(r'\1', ' '.join(text.split()))
    if len(text) <= MAX_DESCRIPTION_CHARS:
        return text
    cut = text[:MAX_DESCRIPTION_CHARS]
    return (cut[: cut.rfind('. ') + 1] if '. ' in cut else cut.rstrip()) or cut


def parse_details(details: str) -> dict:
    """State, description and links from a Datadog message or Grafana's details table."""
    parsed: dict = {'links': {}}
    rows = {}
    for line in details.splitlines():
        line = line.strip()
        if (row := GRAFANA_ROW.match(line)):
            rows[row.group(1)] = row.group(2)
        elif (state := DATADOG_STATE.match(line)):
            parsed['state'] = f"{state.group(1)} {state.group(2).lower()}: {state.group(3)}"
        elif (link := LINK_LINE.match(line)):
            parsed['links'].setdefault(link.group(1), link.group(2))
        elif (
            line and 'description' not in parsed and 'state' in parsed
            and not line.startswith(('@', '`', 'http', 'Metric value', 'Paging on-call'))
        ):
            parsed['description'] = line
    if rows:
        severity = rows.get('severity', '')
        parsed['state'] = {'critical': '🔴 critical', 'warning': '🟠 warning'}.get(severity, severity)
        parsed['description'] = rows.get('description', '')
        parsed['scope'] = rows.get('DBInstanceIdentifier') or rows.get('CacheClusterId') or rows.get('QueueName', '')
        for name, key in (('Graph', 'panel_url'), ('Runbook', 'runbook_url')):
            if rows.get(key):
                parsed['links'][name] = rows[key]
    return parsed


def markdown_links(links: dict[str, str]) -> str:
    return ' · '.join(f"[{name}]({url})" for name, url in links.items() if url)


def headline(payload: dict) -> tuple[str, str]:
    """The page or notify marker, and the alert's cleaned-up title with its scope."""
    marker = '🔔' if 'Notify' in payload.get('ServiceName', '') else '🚨 **PAGE**'
    title, scope = datadog_title(payload.get('Summary', ''))
    return marker, f"{title} — {scope}" if scope else title


def alert_post(payload: dict) -> str:
    """
    ---
    🚨 **PAGE** · macro-db-prod CPU high — macro-db-prod
    🔴 critical: 92 (threshold 85)
    macro-db-prod CPU averaged 92% over 15 minutes.
    [Acknowledge](…) · [Graph](…) · [Runbook](…)
    """
    marker, title = headline(payload)
    parsed = parse_details(payload.get('Details', ''))
    if parsed.get('scope') and parsed['scope'] not in title:
        title = f"{title} — {parsed['scope']}"
    links = {'Acknowledge': payload.get('GoAlertURL', '')}
    links['Graph'] = parsed['links'].get('Graph') or parsed['links'].get('Dashboard') or parsed['links'].get('Metric Graph', '')
    links['Runbook'] = parsed['links'].get('Runbook', '')
    lines = ['---', f"{marker} · **{title}**"]
    if parsed.get('state'):
        lines.append(parsed['state'])
    if parsed.get('description'):
        lines.append(first_sentences(parsed['description']))
    lines.append(markdown_links(links))
    return '\n'.join(lines)


def goalert_content(payload: dict) -> str | None:
    kind = payload.get('Type')
    link = payload.get('GoAlertURL', '')
    if kind == 'Alert':
        return alert_post(payload)
    if kind == 'AlertStatus':
        _, title = headline(payload)
        return f"---\n{payload.get('LogEntry', '')} · {title} · [Open]({link})"
    if kind == 'AlertBundle':
        marker, _ = headline(payload)
        return f"---\n{marker} · {payload.get('Count')} alerts on {payload.get('ServiceName', '')} · [Acknowledge]({link})"
    if kind == 'AlertStatusBundle':
        return f"---\n{payload.get('LogEntry', '')} ({payload.get('Count')} alerts) · [Open]({link})"
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
            self.server.webhook_url,
            data=json.dumps({'content': content[:MAX_CONTENT_CHARS]}).encode(),
            headers={'Content-Type': 'application/json', 'x-macro-channel-bot-token': self.server.bot_token},
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
    credentials = Path(os.environ['CREDENTIALS_DIRECTORY'])
    server = ThreadingHTTPServer(('127.0.0.1', 8090), Relay)
    server.webhook_url = (credentials / 'macro_alerts_webhook_url').read_text()
    server.bot_token = (credentials / 'macro_alerts_bot_token').read_text()
    server.serve_forever()

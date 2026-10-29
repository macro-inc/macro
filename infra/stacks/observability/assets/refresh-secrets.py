#!/usr/bin/env python3
"""Fetch credentials without putting their contents in user-data or logs."""
import json
import os
from pathlib import Path
import re
import subprocess

config = json.loads(Path('/opt/observability/bootstrap.json').read_text())
result = subprocess.run(
    ['aws', 'secretsmanager', 'get-secret-value', '--region', config['region'],
     '--secret-id', config['secretArn'], '--output', 'json'],
    check=True, capture_output=True, text=True,
)
values = json.loads(json.loads(result.stdout)['SecretString'])
keys = [
    'google_client_id', 'google_client_secret', 'grafana_secret_key', 'otlp_token',
    'goalert_encryption_key', 'goalert_admin_password',
    'macro_alerts_webhook_url', 'macro_alerts_bot_token',
]
# Validate the entire bundle before writing any file. Token is at least 32 bytes.
for key in keys:
    value = values.get(key)
    if not isinstance(value, str) or not value or value.strip() != value:
        raise SystemExit(f'Missing or invalid secret field: {key}')
    if '\n' in value or '\r' in value:
        raise SystemExit(f'Secret must be a single line: {key}')
for key in ['grafana_secret_key', 'otlp_token', 'goalert_encryption_key', 'goalert_admin_password']:
    if len(values[key]) < 32:
        raise SystemExit(f'Secret too short: {key}')
if not values['macro_alerts_webhook_url'].startswith('https://'):
    raise SystemExit('macro_alerts_webhook_url must use HTTPS')
# GoAlert creates its Grafana integration key, so it can only be added after the
# first boot. Until then GoAlert rejects Grafana's pages with 401, and Grafana
# reports the GoAlert contact point as failing.
grafana_key = values.get('goalert_grafana_integration_key', '')
if not re.fullmatch(r'[0-9a-f-]{36}|', grafana_key):
    raise SystemExit('goalert_grafana_integration_key must be a GoAlert key UUID')
if not grafana_key:
    print('goalert_grafana_integration_key is not set; Grafana cannot page through GoAlert')
values['grafana-goalert.env'] = f'GOALERT_GRAFANA_KEY={grafana_key}\n'
# Native remote-write uses HTTP Basic over TLS. Only the password hash reaches nginx.
hashed = subprocess.run(
    ['openssl', 'passwd', '-6', '-stdin'], input=values['otlp_token'] + '\n',
    check=True, capture_output=True, text=True,
).stdout.strip()
values['metrics.htpasswd'] = 'metrics:' + hashed + '\n'
keys += ['metrics.htpasswd', 'grafana-goalert.env']
directory = Path('/run/macro-observability')
directory.mkdir(mode=0o700, exist_ok=True)
os.chown(directory, 0, 0)
for key in keys:
    path = directory / key
    # Dependent services stop during refresh and receive private systemd credentials.
    path.unlink(missing_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(fd, 'w') as output:
        output.write(values[key])
        os.fchown(output.fileno(), 0, 0)

"""Validate nonsecret EC2 settings for native NixOS services."""
import gzip
import json
from pathlib import Path
import re
import urllib.request

CONFIG_ROOT = Path('/opt/observability')
SETTING_KEYS = {
    'region', 'grafanaHost', 'otlpHost', 'allowedEmails', 'adminEmails',
    'secretArn', 'volumeId', 'logsBucket', 'tracesBucket',
}


def validate_payload(payload):
    if not isinstance(payload, dict) or set(payload) != {'version', 'settings'} or payload['version'] != 3:
        raise ValueError('Unsupported observability user-data schema')
    settings = payload['settings']
    if not isinstance(settings, dict) or set(settings) != SETTING_KEYS:
        raise ValueError('Invalid observability runtime setting keys')
    patterns = {
        'region': r'us-east-2',
        'grafanaHost': r'[a-z0-9-]+\.macro-internal\.com',
        'otlpHost': r'[a-z0-9-]+\.macro-internal\.com',
        'secretArn': r'arn:aws:secretsmanager:us-east-2:\d{12}:secret:[a-zA-Z0-9/_+=.@-]+',
        'volumeId': r'vol-[a-f0-9]+',
        'logsBucket': r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',
        'tracesBucket': r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',
    }
    for key, pattern in patterns.items():
        if not isinstance(settings[key], str) or not re.fullmatch(pattern, settings[key]):
            raise ValueError(f'Invalid runtime setting: {key}')
    if settings['grafanaHost'] == settings['otlpHost']:
        raise ValueError('UI and ingestion require separate hostnames')
    for key in ['allowedEmails', 'adminEmails']:
        emails = settings[key]
        if not isinstance(emails, list) or not emails or any(
            not isinstance(email, str) or not re.fullmatch(r'[a-z0-9._+-]+@macro\.com', email)
            for email in emails
        ):
            raise ValueError(f'Invalid approved identity list: {key}')
    if not set(settings['adminEmails']).issubset(settings['allowedEmails']):
        raise ValueError('Every admin must also be approved')
    return settings


def write_runtime(payload, output_root):
    settings = validate_payload(payload)
    admin_list = json.dumps(settings['adminEmails'], separators=(',', ':'))
    allowed_list = json.dumps(settings['allowedEmails'], separators=(',', ':'))
    environment = {
        'AWS_REGION': settings['region'],
        'GRAFANA_HOST': settings['grafanaHost'],
        'GRAFANA_ROOT_URL': 'https://' + settings['grafanaHost'] + '/',
        'LOGS_BUCKET': settings['logsBucket'],
        'TRACES_BUCKET': settings['tracesBucket'],
        'GRAFANA_ROLE_EXPRESSION': f"contains(`{admin_list}`, email) && 'GrafanaAdmin' || contains(`{allowed_list}`, email) && 'Viewer' || 'Denied'",
    }
    # systemd EnvironmentFile accepts double-quoted, escaped values. Inputs are
    # validated ASCII; no shell ever evaluates these values or the role expression.
    files = {
        'runtime.env': ''.join(f'{key}={json.dumps(value)}\n' for key, value in environment.items()),
        'hosts.conf': (
            'map $host $observability_host {\n  default denied;\n'
            f"  {settings['grafanaHost']} grafana;\n  {settings['otlpHost']} otlp;\n"
            '}\nmap "" $grafana_host {\n'
            f"  default {settings['grafanaHost']};\n" + '}\n'
        ),
        'bootstrap.json': json.dumps({'region': settings['region'], 'secretArn': settings['secretArn']}),
        'volume-id': settings['volumeId'],
    }
    output_root.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name, content in files.items():
        (output_root / name).write_text(content)


def main():
    endpoint = 'http://169.254.169.254/latest/'
    # Metadata access must never use a configured HTTP proxy.
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    token_request = urllib.request.Request(
        endpoint + 'api/token', method='PUT',
        headers={'X-aws-ec2-metadata-token-ttl-seconds': '60'},
    )
    with http.open(token_request, timeout=10) as response:
        token = response.read().decode()
    request = urllib.request.Request(
        endpoint + 'user-data', headers={'X-aws-ec2-metadata-token': token},
    )
    with http.open(request, timeout=10) as response:
        raw = response.read(16385)
    if len(raw) > 16384:
        raise ValueError('User data exceeds EC2 limit')
    payload = json.loads(gzip.decompress(raw))
    write_runtime(payload, CONFIG_ROOT)


if __name__ == '__main__':
    main()

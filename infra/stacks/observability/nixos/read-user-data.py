"""Read IMDSv2 runtime values and render the service configuration owned by Nix."""
import gzip
import json
from pathlib import Path
import re
import urllib.request

TEMPLATE_ROOT = Path('/etc/observability/config')
CONFIG_ROOT = Path('/opt/observability')
CONFIG_FILES = {
    'compose.json', 'grafana.ini', 'datasources.yaml', 'config.alloy',
    'nginx.conf', 'loki.yaml', 'tempo.yaml', 'prometheus.yaml',
}
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
        'grafanaHost': r'[a-z0-9-]+\.macro\.com',
        'otlpHost': r'[a-z0-9-]+\.macro\.com',
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


def render_payload(payload, template_root, output_root):
    settings = validate_payload(payload)
    admin_list = json.dumps(settings['adminEmails'], separators=(',', ':'))
    allowed_list = json.dumps(settings['allowedEmails'], separators=(',', ':'))
    values = {
        'REGION': settings['region'],
        'GRAFANA_HOST': settings['grafanaHost'],
        'OTLP_HOST': settings['otlpHost'],
        'LOGS_BUCKET': settings['logsBucket'],
        'TRACES_BUCKET': settings['tracesBucket'],
        'ROLE_EXPRESSION': f"contains(`{admin_list}`, email) && 'GrafanaAdmin' || contains(`{allowed_list}`, email) && 'Viewer' || 'Denied'",
    }
    if {path.name for path in template_root.iterdir()} != CONFIG_FILES:
        raise ValueError('Unexpected Nix configuration template set')

    def substitute(text):
        def replace(match):
            if match[1] not in values:
                raise ValueError(f'Unknown Nix runtime parameter: {match[1]}')
            return values[match[1]]
        return re.sub(r'@@([A-Z_]+)@@', replace, text)

    def substitute_json(value):
        if isinstance(value, str):
            return substitute(value)
        if isinstance(value, list):
            return [substitute_json(item) for item in value]
        if isinstance(value, dict):
            return {key: substitute_json(item) for key, item in value.items()}
        return value

    # Substitute JSON values after parsing, so quotes in the role expression
    # remain a string value and can never change the Compose document structure.
    files = {}
    for name in CONFIG_FILES:
        template = (template_root / name).read_text()
        files[name] = (json.dumps(substitute_json(json.loads(template)), indent=2)
                       if name.endswith('.json') else substitute(template))
    files['bootstrap.json'] = json.dumps({
        'region': settings['region'], 'secretArn': settings['secretArn'],
    })
    files['volume-id'] = settings['volumeId']
    # Validate and render everything before writing any configuration.
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
    render_payload(payload, TEMPLATE_ROOT, CONFIG_ROOT)


if __name__ == '__main__':
    main()

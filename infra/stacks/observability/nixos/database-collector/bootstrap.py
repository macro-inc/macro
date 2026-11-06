"""Read nonsecret EC2 metadata and retrieve the collector's runtime credentials."""
import gzip
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request


def metadata():
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = 'http://169.254.169.254/latest/'
    request = urllib.request.Request(base + 'api/token', method='PUT',
        headers={'X-aws-ec2-metadata-token-ttl-seconds': '60'})
    with http.open(request, timeout=10) as response:
        token = response.read().decode()
    request = urllib.request.Request(base + 'user-data',
        headers={'X-aws-ec2-metadata-token': token})
    with http.open(request, timeout=10) as response:
        raw = response.read(16385)
    if len(raw) > 16384:
        raise ValueError('User data exceeds EC2 limit')
    return validate(json.loads(gzip.decompress(raw)))


def validate(settings):
    patterns = {
        'region': r'us-east-1', 'environment': r'dev',
        'volumeId': r'vol-[a-f0-9]+',
        'secretArn': r'arn:aws:secretsmanager:us-east-1:569036502058:secret:[a-zA-Z0-9/_+=.@-]+',
        'ingestSecretArn': r'arn:aws:secretsmanager:us-east-1:569036502058:secret:[a-zA-Z0-9/_+=.@-]+',
        'writerHost': r'macro-db-dev\.[a-z0-9]+\.us-east-1\.rds\.amazonaws\.com',
        'replicaHost': r'macro-db-dev-read-replica\.[a-z0-9]+\.us-east-1\.rds\.amazonaws\.com',
    }
    if not isinstance(settings, dict) or set(settings) != set(patterns) | {'version'} or settings['version'] != 1:
        raise ValueError('Unsupported database collector metadata')
    for key, pattern in patterns.items():
        if not isinstance(settings[key], str) or not re.fullmatch(pattern, settings[key]):
            raise ValueError(f'Invalid collector setting: {key}')
    return settings


def secret(arn):
    result = subprocess.run(['aws', 'secretsmanager', 'get-secret-value',
        '--region', 'us-east-1', '--secret-id', arn, '--output', 'json'],
        check=True, capture_output=True, text=True)
    return json.loads(result.stdout)['SecretString']


def main():
    settings = metadata()
    root = Path('/opt/observability')
    root.mkdir(mode=0o755, parents=True, exist_ok=True)
    (root / 'volume-id').write_text(settings['volumeId'])
    password = json.loads(secret(settings['secretArn']))['password']
    token = secret(settings['ingestSecretArn'])
    for name, value in [('password', password), ('ingest token', token)]:
        if not isinstance(value, str) or len(value) < 32 or value.strip() != value or '\n' in value or '\r' in value or '\x00' in value:
            raise ValueError(f'Invalid {name}')
    options = urllib.parse.urlencode({
        'sslmode': 'verify-full', 'sslrootcert': '/etc/ssl/certs/rds-us-east-1.pem',
        'connect_timeout': '5', 'application_name': 'grafana_database_collector',
    })
    # The monitoring role enforces timeouts/read-only defaults. Alloy's DSN
    # normalization cannot round-trip a libpq options value containing spaces.
    values = {'otlp_token': token}
    for target in ['writer', 'replica']:
        values[target + '_dsn'] = (
            'postgresql://grafana_monitor:' + urllib.parse.quote(password, safe='')
            + '@' + settings[target + 'Host'] + ':5432/macrodb?' + options
        )
    directory = Path('/run/macro-database-collector')
    directory.mkdir(mode=0o700, exist_ok=True)
    for name, value in values.items():
        path = directory / name
        path.unlink(missing_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        with os.fdopen(fd, 'w') as output:
            output.write(value)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # SDK/database errors may include credentials; never log exception payloads.
        raise SystemExit('Database collector bootstrap failed; check metadata, secret schema and IAM access') from None

"""Run the baked host agents against the smoke stack, fake IMDS and local AWS."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import gzip
import re
import os
from pathlib import Path
import subprocess
import socket
import threading
import time
import urllib.parse


def check_collectors(root, flake, project, prometheus, loki, request, eventually, docker):
    expression = f'''let
      f = builtins.getFlake {json.dumps('path:' + str(flake))};
      c = f.nixosConfigurations.observability.config;
    in {{
      alloy = c.services.alloy.package;
      cloudwatch = c.services.amazon-cloudwatch-agent.package;
      alloyConfig = c.services.alloy.configPath;
      cloudwatchConfig = c.services.amazon-cloudwatch-agent.configurationFile;
      systemd = f.inputs.nixpkgs.legacyPackages.x86_64-linux.systemd;
    }}'''
    subprocess.run(['nix', 'build', '--impure', '--expr', f'builtins.attrValues ({expression})',
                    '--no-link'], check=True, capture_output=True)
    paths = json.loads(subprocess.check_output([
        'nix', 'eval', '--impure', '--json', '--expr',
        f'builtins.mapAttrs (_: value: toString value) ({expression})',
    ], text=True))
    subprocess.run(['sudo', '-n', 'true'], check=True)
    journal = root / 'journal'
    journal.mkdir()
    entry = (f'__REALTIME_TIMESTAMP={time.time_ns() // 1000}\n'
             '_BOOT_ID=11111111111111111111111111111111\n'
             '_MACHINE_ID=22222222222222222222222222222222\n'
             '_SYSTEMD_UNIT=observability.service\nPRIORITY=6\n'
             'MESSAGE=host-journal-smoke-marker\n\n')
    subprocess.run([paths['systemd'] + '/lib/systemd/systemd-journal-remote',
                    '--output=' + str(journal / 'system.journal'), '--split-mode=none', '-'],
                   input=entry, text=True, check=True, capture_output=True)
    alloy_config = Path(paths['alloyConfig']).read_text().replace(
        'http://127.0.0.1:9090', prometheus).replace('http://127.0.0.1:3100', loki).replace(
        'macro-observability', project)
    for source in ['host', 'kernel']:
        alloy_config = alloy_config.replace(f'loki.source.journal "{source}" {{',
                                            f'loki.source.journal "{source}" {{\n  path = "{journal}"')
    (root / 'host.alloy').write_text(alloy_config)
    subprocess.run([paths['alloy'] + '/bin/alloy', 'validate', str(root / 'host.alloy')], check=True)

    metric_batches = []

    class Metadata(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            if self.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
            if body.startswith(b'{'):
                payload = json.loads(body)
                assert payload['Namespace'] == 'Macro/Observability'
                metrics = payload.get('MetricData', [])
                for entity in payload.get('EntityMetricData', []):
                    metrics += entity.get('MetricData', [])
                reply = b'{}'
            else:
                fields = {k: v[0] for k, v in urllib.parse.parse_qs(body.decode()).items()}
                assert fields['Action'] == 'PutMetricData'
                assert fields['Namespace'] == 'Macro/Observability'
                metrics = []
                for key, name in fields.items():
                    if not key.endswith('.MetricName'):
                        continue
                    prefix = key[:-len('MetricName')]
                    dimensions = []
                    for dimension_key, dimension_name in fields.items():
                        if re.fullmatch(re.escape(prefix) + r'Dimensions\.member\.[0-9]+\.Name', dimension_key):
                            dimensions.append({'Name': dimension_name,
                                               'Value': fields[dimension_key[:-4] + 'Value']})
                    metrics.append({'MetricName': name, 'Dimensions': dimensions})
                reply = b'<PutMetricDataResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/"><ResponseMetadata><RequestId>smoke</RequestId></ResponseMetadata></PutMetricDataResponse>'
            metric_batches.extend(metrics)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(reply)

        def do_PUT(self):
            self.send_response(200)
            self.send_header('X-aws-ec2-metadata-token-ttl-seconds', '21600')
            self.end_headers()
            self.wfile.write(b'smoke-imds-token')

        def do_GET(self):
            if self.headers.get('X-aws-ec2-metadata-token') != 'smoke-imds-token':
                self.send_response(401)
                self.end_headers()
                return
            values = {
                '/latest/dynamic/instance-identity/document': json.dumps({
                    'instanceId': 'i-0123456789abcdef0', 'region': 'us-east-2',
                    'accountId': '123456789012', 'instanceType': 'm7i.xlarge',
                    'imageId': 'ami-0123456789abcdef0', 'availabilityZone': 'us-east-2a',
                }),
                '/latest/meta-data/instance-id': 'i-0123456789abcdef0',
                '/latest/meta-data/hostname': 'observability-smoke',
                '/latest/meta-data/placement/availability-zone': 'us-east-2a',
            }
            self.send_response(200 if self.path in values else 404)
            self.end_headers()
            self.wfile.write(values.get(self.path, '').encode())

    metadata = ThreadingHTTPServer(('127.0.0.1', 0), Metadata)
    threading.Thread(target=metadata.serve_forever, daemon=True).start()
    environment = {key: value for key, value in os.environ.items() if not key.startswith('AWS_')}
    environment.update({
        'AWS_ACCESS_KEY_ID': 'test', 'AWS_SECRET_ACCESS_KEY': 'test',
        'AWS_REGION': 'us-east-2', 'AWS_DEFAULT_REGION': 'us-east-2',
        'AWS_CONFIG_FILE': '/dev/null', 'AWS_SHARED_CREDENTIALS_FILE': '/dev/null',
        'AWS_EC2_METADATA_SERVICE_ENDPOINT': f'http://127.0.0.1:{metadata.server_port}',
    })
    cloudwatch_config = json.loads(Path(paths['cloudwatchConfig']).read_text())
    cloudwatch_config['agent']['metrics_collection_interval'] = 1
    cloudwatch_config['metrics']['force_flush_interval'] = 1
    cloudwatch_config['metrics']['endpoint_override'] = f'http://127.0.0.1:{metadata.server_port}'
    # This path deliberately isn't mounted: it must not report root-disk usage.
    missing_mount = str(root / 'not-mounted')
    cloudwatch_config['metrics']['metrics_collected']['disk']['resources'] = ['/', missing_mount]
    (root / 'cloudwatch.json').write_text(json.dumps(cloudwatch_config))
    (root / 'common.toml').write_text('')
    (root / 'cloudwatch.d').mkdir()
    processes = []
    try:
        with (root / 'cloudwatch.log').open('w') as log:
            subprocess.run([paths['cloudwatch'] + '/bin/config-translator',
                            '-config', str(root / 'common.toml'),
                            '-input', str(root / 'cloudwatch.json'),
                            '-input-dir', str(root / 'cloudwatch.d'),
                            '-mode', 'ec2', '-output', str(root / 'cloudwatch.toml')],
                           check=True, env=environment, stdout=log, stderr=subprocess.STDOUT, timeout=30)
            processes.append((subprocess.Popen([
                paths['cloudwatch'] + '/bin/amazon-cloudwatch-agent',
                '-config', str(root / 'cloudwatch.toml'),
                '-envconfig', str(root / 'env-config.json'),
                '-otelconfig', str(root / 'amazon-cloudwatch-agent.yaml'),
                '-pidfile', str(root / 'cloudwatch.pid'),
            ], env=environment, stdout=log, stderr=subprocess.STDOUT), False))
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            alloy_port = listener.getsockname()[1]
        with (root / 'host-alloy.log').open('w') as log:
            processes.append((subprocess.Popen([
                'sudo', '-n', '--', paths['alloy'] + '/bin/alloy', 'run', str(root / 'host.alloy'),
                f'--server.http.listen-addr=127.0.0.1:{alloy_port}', '--disable-reporting',
                '--storage.path=' + str(root / 'data/host-alloy'),
            ], stdout=log, stderr=subprocess.STDOUT, start_new_session=True), True))

        def metric(name):
            body = request(prometheus, '/api/v1/query?' + urllib.parse.urlencode({'query': name}))[1]
            return json.loads(body).get('data', {}).get('result', [])

        def cloudwatch_ready():
            metrics = list(metric_batches)
            return {item['MetricName'] for item in metrics} >= {'disk_used_percent', 'mem_used_percent'}

        eventually(cloudwatch_ready, seconds=120)
        for metric_data in list(metric_batches):
            dimensions = {d['Name']: d['Value'] for d in metric_data['Dimensions']}
            assert dimensions['InstanceId'] == 'i-0123456789abcdef0', metric_data
            if metric_data['MetricName'] == 'disk_used_percent':
                assert dimensions == {'InstanceId': 'i-0123456789abcdef0', 'path': '/', 'fstype': 'ext4'}, metric_data
            elif metric_data['MetricName'] == 'mem_used_percent':
                assert dimensions == {'InstanceId': 'i-0123456789abcdef0'}, metric_data
        eventually(lambda: metric('node_memory_MemTotal_bytes'), seconds=120)
        eventually(lambda: metric('node_filesystem_size_bytes{mountpoint="/"}'))
        eventually(lambda: metric('container_memory_working_set_bytes'), seconds=120)
        container_metrics = metric('container_cpu_usage_seconds_total')
        assert container_metrics
        assert all(item['metric']['container_label_com_docker_compose_project'] == project
                   for item in container_metrics), 'Leaked metrics from unrelated containers'
        # /healthz suppresses access logs; request a logged 404 to test Docker logs.
        request('http://' + docker('port', 'proxy', '8080'), '/collector-smoke-marker')
        for selector, marker in [
            ('{job="observability/containers",service_name="proxy"}', 'collector-smoke-marker'),
            ('{job="observability/journal",unit="observability.service"}', 'host-journal-smoke-marker'),
        ]:
            query = '/loki/api/v1/query_range?' + urllib.parse.urlencode({'query': selector})
            eventually(lambda: marker in request(loki, query)[1], seconds=120)
        print('PASS: native Alloy host/container metrics, Docker/journal logs, CloudWatch metric dimensions and missing mount')
    except BaseException:
        for name in ['cloudwatch.log', 'host-alloy.log']:
            path = root / name
            if path.exists():
                print(path.read_text()[-14000:])
        raise
    finally:
        for process, privileged in reversed(processes):
            if process.poll() is not None:
                continue
            if privileged:
                subprocess.run(['sudo', '-n', 'kill', '-TERM', '--', '-' + str(process.pid)], check=False)
            else:
                process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                if privileged:
                    subprocess.run(['sudo', '-n', 'kill', '-KILL', '--', '-' + str(process.pid)], check=False)
                else:
                    process.kill()
                process.wait(timeout=5)
        metadata.shutdown()
        metadata.server_close()

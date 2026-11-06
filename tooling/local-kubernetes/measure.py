#!/usr/bin/env python3
"""Append repeatable local runtime measurements to a JSONL file.

Each invocation records the commit and host load. Timed commands are argv, never
shell strings. Cold/warm lifecycle commands and cache preparation are explicit.
"""
import argparse
from datetime import datetime, timezone
import json
import math
import os
import re
from pathlib import Path
import statistics
import subprocess
import time

from run import ROOT, STATE, kube


def output(command):
    return subprocess.check_output(command, text=True, cwd=ROOT)


def host():
    return {
        'loadavg': Path('/proc/loadavg').read_text().strip(),
        'cpu_pressure': Path('/proc/pressure/cpu').read_text().strip(),
        'io_pressure': Path('/proc/pressure/io').read_text().strip(),
        'memory_pressure': Path('/proc/pressure/memory').read_text().strip(),
    }


def node_stats(namespace):
    stats = json.loads(kube('get', '--raw', f'/api/v1/nodes/macro-eks-local-control-plane/proxy/stats/summary', capture=True))
    pods = [p for p in stats['pods'] if p['podRef']['namespace'] == namespace]
    if not pods:
        raise RuntimeError('namespace has no measured pods')
    containers = [c for pod in pods for c in pod['containers']]
    return {
        'ram_bytes': sum(p['memory']['workingSetBytes'] for p in pods),
        'cpu_core_seconds': sum(p['cpu']['usageCoreNanoSeconds'] for p in pods) / 1e9,
        'pod_cpu': {p['podRef']['uid']: {
            'seconds': p['cpu']['usageCoreNanoSeconds'] / 1e9,
            'at': datetime.fromisoformat(p['cpu']['time'].replace('Z', '+00:00')).timestamp(),
        } for p in pods},
        'disk_writable_bytes': sum(c.get('rootfs', {}).get('usedBytes', 0) + c.get('logs', {}).get('usedBytes', 0) for c in containers),
        'disk_volume_bytes': sum(v.get('usedBytes', 0) for p in pods for v in p.get('volume', [])),
        'shared_node_ram_bytes': stats['node']['memory']['workingSetBytes'],
        'shared_node_cpu_core_seconds': stats['node']['cpu']['usageCoreNanoSeconds'] / 1e9,
        'shared_node_cpu_at': datetime.fromisoformat(stats['node']['cpu']['time'].replace('Z', '+00:00')).timestamp(),
    }


def kube_cpu_rates(first, last):
    """Normalize counters using their metric timestamps, not HTTP sampling time."""
    def rate(start, end, elapsed):
        if elapsed <= 0 or end < start:
            raise RuntimeError('CPU metrics stalled or reset; repeat with stable pods')
        return (end - start) / elapsed

    if first['pod_cpu'].keys() != last['pod_cpu'].keys():
        raise RuntimeError('pods changed during sampling; repeat with stable pods')
    pods = sum(rate(value['seconds'], last['pod_cpu'][uid]['seconds'],
                    last['pod_cpu'][uid]['at'] - value['at'])
               for uid, value in first['pod_cpu'].items())
    node = rate(first['shared_node_cpu_core_seconds'], last['shared_node_cpu_core_seconds'],
                last['shared_node_cpu_at'] - first['shared_node_cpu_at'])
    return pods, node


def persistent_volume_bytes(namespace):
    """Host-path PVC usage is absent from kubelet summary volume metrics."""
    claims = json.loads(kube('-n', namespace, 'get', 'pvc', '-o', 'json', capture=True))
    names = [c['spec']['volumeName'] for c in claims['items'] if c['status']['phase'] == 'Bound']
    if not names:
        return 0
    volumes = json.loads(kube('get', 'pv', *names, '-o', 'json', capture=True))
    paths = []
    for volume in volumes['items']:
        if volume['spec']['claimRef']['namespace'] != namespace:
            raise RuntimeError('persistent volume belongs to another namespace')
        path = volume['spec']['hostPath']['path']
        if not path.startswith('/var/local-path-provisioner/'):
            raise RuntimeError('unexpected persistent volume path')
        paths.append(path)
    return sum(int(line.split()[0]) for line in output([
        'docker', 'exec', 'macro-eks-local-control-plane', 'du', '-s', '-B1', '--', *paths]).splitlines())


def node_disk():
    """Count the owned node's writable layer and volumes, including image cache."""
    node = json.loads(output(['docker', 'inspect', '--size', 'macro-eks-local-control-plane']))[0]
    volumes = {m['Source'] for m in node['Mounts'] if m['Type'] == 'volume'}
    size = sum(int(output(['sudo', '-n', 'du', '-s', '-B1', source]).split()[0]) for source in volumes)
    image = json.loads(output(['docker', 'image', 'inspect', node['Image']]))[0]
    return {'shared_node_total_writable_disk_bytes': node['SizeRw'] + size,
            'shared_node_base_image_logical_bytes': image['Size']}


def compose_stats(instance):
    ids = output(['docker', 'ps', '-q', '--filter', f'label=com.docker.compose.project=macro-{instance}']).split()
    if not ids:
        raise RuntimeError('Compose instance has no running containers')
    data = [json.loads(line) for line in output(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *ids]).splitlines()]
    # Docker CLI already subtracts inactive file cache, like kube workingSet.
    def size(value):
        match = re.fullmatch(r'([0-9.]+)\s*(B|KiB|MiB|GiB)', value.strip())
        if not match:
            raise RuntimeError(f'unrecognized Docker size: {value}')
        number, unit = match.groups()
        return float(number) * {'B': 1, 'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3}[unit]
    memory = sum(size(row['MemUsage'].split(' / ')[0]) for row in data)
    cpu = sum(float(row['CPUPerc'].rstrip('%')) for row in data) / 100
    inspect = json.loads(output(['docker', 'inspect', '--size', *ids]))
    volumes = {mount['Source'] for container in inspect for mount in container['Mounts'] if mount['Type'] == 'volume'}
    volume_bytes = sum(int(output(['sudo', '-n', 'du', '-s', '-B1', source]).split()[0]) for source in volumes)
    logs = [c['LogPath'] for c in inspect if c.get('LogPath')]
    log_bytes = sum(int(value) for value in output(['sudo', '-n', 'stat', '-c', '%s', '--', *logs]).split()) if logs else 0
    return {'ram_bytes': memory, 'cpu_cores': cpu,
            'disk_volume_bytes': volume_bytes,
            'disk_writable_bytes': sum(c.get('SizeRw', 0) for c in inspect) + log_bytes}


def process_stats(pid):
    pending = [pid]
    ram = 0
    cpu = 0
    while pending:
        current = pending.pop()
        path = Path('/proc') / str(current)
        try:
            stat = (path / 'stat').read_text().rpartition(') ')[2].split()
            ram += int(stat[21]) * os.sysconf('SC_PAGE_SIZE')
            cpu += (int(stat[11]) + int(stat[12])) / os.sysconf('SC_CLK_TCK')
            pending.extend(int(child) for child in (path / 'task' / str(current) / 'children').read_text().split())
        except FileNotFoundError:
            continue
    return ram, cpu


def latency(url, cookie_file=None):
    result = {}
    # Fixed successful gateway requests. Browser navigation is a separate check;
    # an HTML transfer must never be described as a rendered page load.
    routes = ['/auth/health', '/connection-gateway/health', '/contacts/health', '/dss/health', '/app/']
    if cookie_file:
        routes.append('/auth/user/me')
    for path in routes:
        samples = []
        for _ in range(100):
            cookies = ['--cookie', str(cookie_file)] if cookie_file else []
            value = output(['curl', *cookies, '--fail', '--silent', '--show-error', '--max-time', '30',
                            '--cacert', str(ROOT / 'infra/local/certs/ca.pem'),
                            '--output', '/dev/null', '--write-out', '%{time_total}', url.rstrip('/') + path])
            samples.append(float(value) * 1000)
        samples.sort()
        result[path] = {'p50_ms': statistics.median(samples),
                        'p95_ms': samples[math.ceil(len(samples) * .95) - 1], 'n': len(samples)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--runtime', choices=['kube', 'compose'], required=True)
    parser.add_argument('--instance', required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--url')
    parser.add_argument('--cookie-file', type=Path, help='private curl cookie jar for an authenticated API probe')
    parser.add_argument('--sample-seconds', type=int, default=60)
    parser.add_argument('--process-root', type=int, help='PID of this instance run_local launcher; includes Vite descendants')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.sample_seconds < 10:
        parser.error('--sample-seconds must be at least 10')
    entry = {'commit': output(['git', 'rev-parse', 'HEAD']).strip(),
             'at': datetime.now(timezone.utc).isoformat(), 'runtime': args.runtime,
             'instance': args.instance, 'label': args.label, 'host_before': host()}
    command = args.command
    if command and command[0] == '--':
        command = command[1:]
    if command:
        started = time.monotonic()
        subprocess.run(command, cwd=ROOT, check=True)
        entry['seconds'] = time.monotonic() - started
    elif args.url:
        entry['latency'] = latency(args.url, args.cookie_file)
    else:
        samples = []
        started = time.monotonic()
        while time.monotonic() - started < args.sample_seconds:
            if args.runtime == 'kube':
                samples.append(dict(node_stats('macro-kube-' + args.instance), sampled_at=time.monotonic()))
            else:
                samples.append(dict(compose_stats(args.instance), sampled_at=time.monotonic()))
            if args.process_root:
                ram, cpu = process_stats(args.process_root)
                samples[-1]['ram_bytes'] += ram
                samples[-1]['host_cpu_core_seconds'] = cpu
            time.sleep(5)
        entry['samples'] = samples
        if args.runtime == 'kube':
            entry['cpu_cores'], node_cpu = kube_cpu_rates(samples[0], samples[-1])
            entry['shared_node_cpu_cores'] = node_cpu
            # These intervals can still have different endpoints. Keep the signed
            # difference visible rather than silently clamping an inconsistency.
            entry['shared_node_overhead_cpu_cores'] = node_cpu - entry['cpu_cores']
            entry['shared_node_overhead_ram_bytes'] = statistics.median(
                s['shared_node_ram_bytes'] - s['ram_bytes'] for s in samples)
        else:
            entry['cpu_cores'] = statistics.median(s['cpu_cores'] for s in samples)
        if args.process_root:
            elapsed = samples[-1]['sampled_at'] - samples[0]['sampled_at']
            entry['cpu_cores'] += (samples[-1]['host_cpu_core_seconds'] - samples[0]['host_cpu_core_seconds']) / elapsed
        entry['ram_bytes'] = statistics.median(s['ram_bytes'] for s in samples)
        if args.runtime == 'kube':
            # Disk inspection is outside the CPU/RAM sampling window.
            entry.update(node_disk())
            entry['disk_persistent_volume_bytes'] = persistent_volume_bytes('macro-kube-' + args.instance)
        if entry['cpu_cores'] < 0:
            raise RuntimeError('CPU counters reset during sampling; repeat with stable pods')
    entry['host_after'] = host()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('a') as target:
        target.write(json.dumps(entry) + '\n')
    print(json.dumps(entry, indent=2))


if __name__ == '__main__':
    main()

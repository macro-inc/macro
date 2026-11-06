#!/usr/bin/env python3
"""Local-only kind runtime for the canonical xtask Compose configuration."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / 'infra/local/generated/kubernetes'
CLUSTER = 'macro-eks-local'
NETWORK = 'macro-eks-kind'
OWNER = str(ROOT)
INFRA = {'postgres', 'redis', 'search', 'kafka', 'localstack', 'db', 'fusionauth', 'mailpit'}


def run(args, *, capture=False, env=None, data=None):
    result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env,
                            input=data, text=True, check=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout if capture else None


def tools():
    path = STATE / 'tools'
    if not path.exists():
        run(['nix', 'build', '.#local-kubernetes-tools', '--out-link', path])
    return path / 'bin'


def kube(*args, capture=False, data=None):
    return run([tools() / 'kubectl', '--kubeconfig', STATE / 'kubeconfig',
                '--context', f'kind-{CLUSTER}', *args], capture=capture, data=data)


def xtask(*args):
    binary = os.environ.get('MACRO_LOCAL_XTASK')
    if binary:
        run([binary, *args])
    else:
        run(['cargo', 'run', '-p', 'xtask_local', '--features', 'local-stack', '--', *args])


def claim(path):
    path.mkdir(parents=True, exist_ok=True)
    marker = path / 'owner.json'
    if marker.exists() and json.loads(marker.read_text()) != OWNER:
        raise RuntimeError(f'{path} belongs to another checkout')
    marker.write_text(json.dumps(OWNER))


def scratch_path():
    record = STATE / 'scratch.json'
    if not record.exists():
        return None
    value = json.loads(record.read_text())
    if value['owner'] != OWNER:
        raise RuntimeError('build scratch belongs to another checkout')
    path = Path(value['path']).resolve(strict=True)
    if not path.is_relative_to('/tmp') or not path.name.startswith('macro-eks-build-'):
        raise RuntimeError('build scratch must be a task-owned temporary directory')
    return path


def cluster():
    claim(STATE)
    if (STATE / 'kubeconfig').exists():
        kube('get', 'nodes')
        mounts = json.loads(run(['docker', 'inspect', f'{CLUSTER}-control-plane'], capture=True))[0]['Mounts']
        if not any(mount['Source'] == '/var/run/docker.sock' for mount in mounts):
            raise RuntimeError('the owned node lacks its sandbox socket mount; recreate it before starting instances')
        scratch = scratch_path()
        if scratch is not None:
            if not any(mount['Source'] == str(scratch) for mount in mounts):
                raise RuntimeError('the owned node does not mount the recorded build scratch; recreate it before starting instances')
        return
    # Docker's default address pools are exhausted on devboxes with many stacks.
    # Creation fails on an overlapping subnet; never prune other stacks.
    networks = run(['docker', 'network', 'ls', '--format', '{{.Name}}'], capture=True).splitlines()
    if NETWORK in networks:
        labels = json.loads(run(['docker', 'network', 'inspect', NETWORK], capture=True))[0]['Labels']
        if labels.get('macro.local.owner') != OWNER:
            raise RuntimeError(f'Docker network {NETWORK} is not owned by this checkout')
    else:
        run(['docker', 'network', 'create', '--subnet', '10.252.250.0/24',
             '--label', f'macro.local.owner={OWNER}', NETWORK])
    config_path = STATE / 'nix-config'
    run(['nix', 'build', '.#local-kubernetes-config', '--out-link', config_path])
    config = json.loads(config_path.read_text())
    config['nodes'][0]['extraMounts'] = [
        {'hostPath': str(ROOT), 'containerPath': str(ROOT)},
        {'hostPath': '/nix/store', 'containerPath': '/nix/store', 'readOnly': True},
        {'hostPath': '/var/run/docker.sock', 'containerPath': '/var/run/docker.sock'},
    ]
    scratch = scratch_path()
    if scratch is not None:
        config['nodes'][0]['extraMounts'].append({'hostPath': str(scratch), 'containerPath': str(scratch)})
    for mapping in config['nodes'][0]['extraPortMappings']:
        with socket.socket() as listener:
            listener.bind(('0.0.0.0', mapping['hostPort']))
    path = STATE / 'kind.json'
    path.write_text(json.dumps(config, indent=2))
    env = dict(os.environ, KIND_EXPERIMENTAL_DOCKER_NETWORK=NETWORK)
    run([tools() / 'kind', 'create', 'cluster', '--name', CLUSTER, '--config', path,
         '--kubeconfig', STATE / 'kubeconfig', '--wait', '180s'], env=env)


def dns(name):
    return name.replace('_', '-')


def normalize(value, names):
    for name in names:
        if '_' in name:
            value = re.sub(r'\b' + re.escape(name) + r'(?=[:/])', dns(name), value)
    return value


def compose(name):
    directory = ROOT / 'infra/local/generated' / name
    envfile = directory / 'local.generated.env'
    env = dict(os.environ, MACRO_ENV_FILE=str(envfile), COMPOSE_PROJECT_NAME=f'macro-{name}')
    command = ['docker', 'compose', '--project-directory', ROOT, '-p', f'macro-{name}',
               '-f', ROOT / 'docker/docker-compose.yml',
               '-f', directory / 'docker-compose.override.yml', '--env-file', envfile]
    config = json.loads(run([*command, 'config', '--format', 'json'], capture=True, env=env))
    return command, env, config


def manifests(config, namespace, slot):
    services = {key: value for key, value in config['services'].items() if not value.get('profiles')}
    objects = [{'apiVersion': 'v1', 'kind': 'Namespace',
                'metadata': {'name': namespace, 'annotations': {'macro.local/checkout': OWNER}}}]
    claims = set()
    for key, value in services.items():
        name = dns(key)
        labels = {'app': name}
        metadata = {'name': name, 'namespace': namespace}
        container = {'name': name, 'image': value.get('image', f"{config['name']}-{key}"),
                     'imagePullPolicy': 'Never',
                     'env': [{'name': k, 'value': normalize(str(v), services)}
                             for k, v in value.get('environment', {}).items() if v is not None]}
        for source, target in [('command', 'args'), ('entrypoint', 'command')]:
            if value.get(source):
                container[target] = value[source] if isinstance(value[source], list) else ['/bin/sh', '-c', value[source]]
        mounts, volumes = [], []
        service_mounts = list(value.get('volumes', []))
        if key in ['ai_editing_worker', 'analytics_proxy']:
            service_mounts.append({'type': 'volume', 'source': name + '-wrangler',
                                   'target': '/app/services/' + name + '/.wrangler'})
        for index, mount in enumerate(service_mounts):
            volume_name = f'v{index}'
            target = mount['target']
            volume = {'name': volume_name}
            if mount['type'] == 'bind':
                source = Path(mount['source'])
                if not (source.is_relative_to(ROOT) or source.is_relative_to('/nix/store') or str(source) == '/var/run/docker.sock' or (scratch_path() is not None and source.is_relative_to(scratch_path()))):
                    raise RuntimeError(f'unsupported host mount {source}; keep inputs in this worktree')
                if not source.exists():
                    if source.is_relative_to(ROOT / 'infra/local/generated') and target in ['/data', '/config']:
                        source.mkdir(parents=True)
                    else:
                        raise RuntimeError(f'host mount is missing: {source}; prepare the instance first')
                volume['hostPath'] = {'path': str(source), 'type': ''}
                if source.is_file() and target == '/etc/caddy/Caddyfile':
                    # Compose permits underscore DNS names; Kubernetes uses RFC 1123.
                    rendered = source.with_name('Caddyfile.kubernetes')
                    rendered.write_text(normalize(source.read_text(), services))
                    volume['hostPath']['path'] = str(rendered)
            else:
                claim_name = dns(mount.get('source') or f'{name}-{index}')
                volume['persistentVolumeClaim'] = {'claimName': claim_name}
                if claim_name not in claims:
                    claims.add(claim_name)
                    objects.append({'apiVersion': 'v1', 'kind': 'PersistentVolumeClaim',
                                    'metadata': {'name': claim_name, 'namespace': namespace},
                                    'spec': {'accessModes': ['ReadWriteOnce'], 'resources': {'requests': {'storage': '10Gi'}}}})
            volumes.append(volume)
            mounts.append({'name': volume_name, 'mountPath': target, 'readOnly': mount.get('read_only', False)})
        if mounts:
            container['volumeMounts'] = mounts
        health = value.get('healthcheck', {}).get('test', [])
        if health and health[0] != 'NONE':
            command = health[1:] if health[0] == 'CMD' else ['/bin/sh', '-c', health[1]]
            probe = {'exec': {'command': command}, 'periodSeconds': 5, 'timeoutSeconds': 10}
            container['readinessProbe'] = probe
            container['startupProbe'] = dict(probe, failureThreshold=120)
        ports = {int(p['target']) for p in value.get('ports', []) if p.get('protocol', 'tcp') == 'tcp'}
        ports.update(int(str(p).split('/')[0]) for p in value.get('expose', []))
        if key == 'kafka':
            ports.update([29092, 29093])
        if key == 'proxy':
            ports.add(32443 + slot)
        if not ports:
            ports.add({'lexical_service': 8096, 'sync_service': 8787, 'websocket_service': 6969,
                       'static_file_cdn': 80, 'ai_editing_worker': 8933, 'analytics_proxy': 8098}.get(key, 8080))
        pod = {'containers': [container], 'volumes': volumes, 'terminationGracePeriodSeconds': 30}
        if key == 'ai_editing_worker':
            volumes.append({'name': 'worker-config', 'emptyDir': {}})
            container.setdefault('volumeMounts', []).append({
                'name': 'worker-config', 'mountPath': '/app/services/ai-editing-worker/.dev.vars',
                'subPath': 'dev.vars'})
            pod['initContainers'] = [{'name': 'worker-config', 'image': container['image'],
                'imagePullPolicy': 'Never', 'command': ['sh', '-c', 'touch /config/dev.vars'],
                'volumeMounts': [{'name': 'worker-config', 'mountPath': '/config'}]}]
        if value.get('ulimits', {}).get('memlock'):
            container['securityContext'] = {'capabilities': {'add': ['IPC_LOCK']}}
        if value.get('user'):
            # Current Compose user values are numeric uid[:gid].
            parts = value['user'].split(':')
            pod['securityContext'] = {'runAsUser': int(parts[0])}
            if len(parts) > 1:
                pod['securityContext']['runAsGroup'] = int(parts[1])
        if value.get('stop_grace_period'):
            duration = value['stop_grace_period']
            if not re.fullmatch(r'(?:[0-9]+[hms])+', duration):
                raise RuntimeError(f'unsupported stop grace period: {duration}')
            pod['terminationGracePeriodSeconds'] = sum(
                int(amount) * {'s': 1, 'm': 60, 'h': 3600}[unit]
                for amount, unit in re.findall(r'([0-9]+)([hms])', duration)
            )
        objects.append({'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': metadata,
                        'spec': {'replicas': 1, 'strategy': {'type': 'Recreate'} if key in INFRA else {'type': 'RollingUpdate'},
                                 'selector': {'matchLabels': labels},
                                 'template': {'metadata': {'labels': labels}, 'spec': pod}}})
        aliases = {name}
        for network in value.get('networks', {}).values():
            aliases.update(dns(a) for a in (network or {}).get('aliases', []))
        for alias in aliases:
            spec = {'selector': labels, 'ports': [{'name': f'p{port}', 'port': port, 'targetPort': port} for port in sorted(ports)]}
            objects.append({'apiVersion': 'v1', 'kind': 'Service',
                            'metadata': {'name': alias, 'namespace': namespace}, 'spec': spec})
        if key == 'proxy':
            objects.append({'apiVersion': 'v1', 'kind': 'Service',
                            'metadata': {'name': 'https', 'namespace': namespace},
                            'spec': {'type': 'NodePort', 'selector': labels,
                                     'ports': [{'port': 443, 'targetPort': 32443 + slot, 'nodePort': 30443 + slot}]}})
    return objects


def apply(objects):
    kube('apply', '-f', '-', data=json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': objects}))


def check_namespace(namespace):
    raw = kube('get', 'namespace', namespace, '-o', 'json', '--ignore-not-found', capture=True)
    if raw and json.loads(raw)['metadata'].get('annotations', {}).get('macro.local/checkout') != OWNER:
        raise RuntimeError(f'{namespace} belongs to another checkout')


@contextlib.contextmanager
def forwards(namespace, config):
    processes = []
    try:
        for name in ['postgres', 'search', 'localstack', 'fusionauth', 'kafka']:
            ports = config['services'][name]['ports']
            mapping = ports[0]
            host_port, target = int(mapping['published']), int(mapping['target'])
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', host_port))
            log = open(STATE / f'{namespace}-{name}.forward.log', 'w')
            process = subprocess.Popen([str(tools() / 'kubectl'), '--kubeconfig', str(STATE / 'kubeconfig'),
                                        '--context', f'kind-{CLUSTER}', '-n', namespace, 'port-forward', f'service/{dns(name)}', f'{host_port}:{target}'],
                                       stdout=log, stderr=log)
            processes.append((process, log, host_port))
        deadline = time.monotonic() + 60
        for process, log, port in processes:
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f'port-forward failed; see {log.name}')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=0.5):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        raise RuntimeError('port-forward timed out')
                    time.sleep(0.1)
        yield
    finally:
        for process, log, _ in processes:
            process.terminate()
            process.wait()
            log.close()


def wait_deployments(namespace, names=None):
    deployments = json.loads(kube('-n', namespace, 'get', 'deployments', '-o', 'json', capture=True))
    for deployment in deployments['items']:
        if names is not None and deployment['metadata']['name'] not in names:
            continue
        kube('-n', namespace, 'rollout', 'status', 'deployment/' + deployment['metadata']['name'], '--timeout=600s')


def up(args):
    cluster()
    namespace = f'macro-kube-{args.name}'
    check_namespace(namespace)
    directory = ROOT / 'infra/local/generated' / args.name
    marker = directory / 'kubernetes-owner.json'
    if directory.exists() and any(directory.iterdir()) and not marker.exists():
        raise RuntimeError('instance artifacts already exist outside this Kubernetes runner; choose a new name')
    running_compose = run(['docker', 'ps', '-aq', '--filter',
                          f'label=com.docker.compose.project=macro-{args.name}'], capture=True).strip()
    if running_compose:
        raise RuntimeError('a Compose instance already uses this name; choose a new name')
    directory.mkdir(parents=True, exist_ok=True)
    if marker.exists() and json.loads(marker.read_text()) != OWNER:
        raise RuntimeError('instance artifacts belong to another checkout')
    marker.write_text(json.dumps(OWNER))
    state = directory / 'kubernetes.json'
    if state.exists():
        previous = json.loads(state.read_text())
        if previous['slot'] != args.slot:
            raise RuntimeError('existing instance has a different HTTPS slot')
        for service in sorted(INFRA):
            kube('-n', namespace, 'scale', f'deployment/{service}', '--replicas=1')
        wait_deployments(namespace, INFRA)
        _, _, config = compose(args.name)
        flags = ['--instance', args.name, '--port-base', str(32434 + args.slot),
                 '--no-doppler', '--traces', 'off', '--env-file',
                 str(directory / 'local.generated.env')]
        with forwards(namespace, config):
            xtask('kubernetes-init', *flags)
        kube('-n', namespace, 'scale', 'deployment', '--all', '--replicas=1')
        wait_deployments(namespace)
    else:
        occupied = kube('get', 'service', '-A', '-o', 'json', capture=True)
        for service in json.loads(occupied)['items']:
            for port in service['spec'].get('ports', []):
                if port.get('nodePort') == 30443 + args.slot and service['metadata']['namespace'] != namespace:
                    raise RuntimeError('HTTPS slot is already occupied')
        flags = ['--instance', args.name, '--port-base', str(32434 + args.slot), '--no-doppler', '--traces', 'off']
        if args.binaries_dir:
            flags += ['--binaries-dir', args.binaries_dir]
        if args.env_file:
            flags += ['--env-file', args.env_file]
        xtask('kubernetes-prepare', *flags)
        command, env, config = compose(args.name)
        services = {k: v for k, v in config['services'].items() if not v.get('profiles')}
        builds = [k for k, v in services.items() if v.get('build')]
        if builds:
            run([*command, 'build', *builds], env=env)
        for key, value in services.items():
            image = value.get('image', f"{config['name']}-{key}")
            exists = subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            if not exists:
                run(['docker', 'pull', image])
            run([tools() / 'kind', 'load', 'docker-image', '--name', CLUSTER, image])
        objects = manifests(config, namespace, args.slot)
        path = state.with_name('kubernetes-manifests.json')
        path.write_text(json.dumps(objects, indent=2))
        path.chmod(0o600)
        backing = [o for o in objects if o['kind'] != 'Deployment' or o['metadata']['name'] in INFRA]
        apply(backing)
        wait_deployments(namespace)
        with forwards(namespace, config):
            xtask('kubernetes-init', *flags)
        apply(objects)
        wait_deployments(namespace)
        state.write_text(json.dumps({'namespace': namespace, 'slot': args.slot, 'owner': OWNER}))
    url = f'https://{socket.gethostname()}:{32443 + args.slot}'
    run(['curl', '--fail', '--silent', '--show-error', '--cacert', ROOT / 'infra/local/certs/ca.pem',
         '--output', '/dev/null', f'{url}/app/'])
    print(f'{url}/app/\n{url}/mailpit/')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['cluster', 'up', 'stop', 'down', 'status', 'roll'])
    parser.add_argument('name', nargs='?')
    parser.add_argument('--slot', type=int, choices=[0, 1], default=0)
    parser.add_argument('--binaries-dir')
    parser.add_argument('--env-file', help='same optional dotenv overlay as run_local')
    parser.add_argument('--service', help='Compose service name for roll; build the binary before rolling')
    args = parser.parse_args()
    os.chdir(ROOT)
    STATE.mkdir(parents=True, exist_ok=True)
    if args.command == 'cluster':
        cluster()
        return
    if not args.name or not re.fullmatch('[a-z0-9][a-z0-9-]{0,29}', args.name):
        parser.error('use an instance name of 1–30 lowercase letters, digits or hyphens')
    if args.command == 'up':
        up(args)
        return
    namespace = f'macro-kube-{args.name}'
    check_namespace(namespace)
    directory = ROOT / 'infra/local/generated' / args.name
    marker = directory / 'kubernetes-owner.json'
    if directory.exists() and any(directory.iterdir()) and not marker.exists():
        raise RuntimeError('instance artifacts already exist outside this Kubernetes runner; choose a new name')
    running_compose = run(['docker', 'ps', '-aq', '--filter',
                          f'label=com.docker.compose.project=macro-{args.name}'], capture=True).strip()
    if running_compose:
        raise RuntimeError('a Compose instance already uses this name; choose a new name')
    directory.mkdir(parents=True, exist_ok=True)
    if marker.exists() and json.loads(marker.read_text()) != OWNER:
        raise RuntimeError('instance artifacts belong to another checkout')
    marker.write_text(json.dumps(OWNER))
    state = directory / 'kubernetes.json'
    if args.command == 'status':
        kube('-n', namespace, 'get', 'pods,svc,pvc')
    elif args.command == 'stop':
        kube('-n', namespace, 'scale', 'deployment', '--all', '--replicas=0')
        kube('-n', namespace, 'wait', 'pod', '--all', '--for=delete', '--timeout=180s')
    elif args.command == 'down':
        kube('delete', 'namespace', namespace, '--wait=true')
        state.unlink(missing_ok=True)
    elif args.command == 'roll':
        if not args.service:
            parser.error('roll requires --service')
        deployment = f'deployment/{dns(args.service)}'
        if args.binaries_dir:
            binary_dir = Path(args.binaries_dir).resolve(strict=True)
            if (binary_dir / 'bin').is_dir():
                binary_dir = binary_dir / 'bin'
            if not (binary_dir.is_relative_to(ROOT) or binary_dir.is_relative_to('/nix/store') or (scratch_path() is not None and binary_dir.is_relative_to(scratch_path()))):
                raise RuntimeError('binary directory must be inside the worktree or Nix store')
            current = json.loads(kube('-n', namespace, 'get', deployment, '-o', 'json', capture=True))
            pod = current['spec']['template']['spec']
            mount = next(m for m in pod['containers'][0]['volumeMounts'] if m['mountPath'] == '/app/out')
            patch = {'spec': {'template': {'spec': {'volumes': [
                {'name': mount['name'], 'hostPath': {'path': str(binary_dir), 'type': ''}}
            ]}}}}
            kube('-n', namespace, 'patch', deployment, '--type=strategic', '-p', json.dumps(patch))
        kube('-n', namespace, 'rollout', 'restart', deployment)
        kube('-n', namespace, 'rollout', 'status', deployment, '--timeout=180s')


if __name__ == '__main__':
    main()

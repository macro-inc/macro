"""Behavioral checks for the Compose-to-Kubernetes boundary; no running cluster."""
import unittest
from unittest.mock import patch
from pathlib import Path
import tempfile

from run import manifests


class ManifestTests(unittest.TestCase):
    def test_nginx_upstreams_use_kubernetes_dns_without_mutating_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'nginx.conf'
            source.write_text('proxy_pass http://static_file_service:8080;')
            config = {'name': 'macro-example', 'services': {
                'static_file_service': {'image': 'runtime:dev'},
                'static_file_cdn': {'image': 'nginx:alpine', 'volumes': [
                    {'type': 'bind', 'source': str(source), 'target': '/etc/nginx/conf.d/default.conf'}]}}}
            with patch('run.ROOT', root), patch('run.STATE', root / 'state'):
                objects = manifests(config, 'macro-kube-example', 0)
            pod = next(o for o in objects if o['kind'] == 'Deployment' and o['metadata']['name'] == 'static-file-cdn')['spec']['template']['spec']
            rendered = Path(pod['volumes'][0]['hostPath']['path'])
            self.assertIn('static-file-service:8080', rendered.read_text())
            self.assertIn('static_file_service:8080', source.read_text())

    def test_routes_aliases_and_private_service_ports(self):
        config = {'name': 'macro-example', 'services': {
            'connection_gateway': {
                'image': 'runtime:dev', 'command': ['/app/out/connection_gateway'],
                'environment': {'UPSTREAM': 'http://connection_gateway:8080'},
                'networks': {'services': {'aliases': ['connection-gateway']}},
                'ports': [{'published': '23012', 'target': 8080}],
                'healthcheck': {'test': ['CMD', 'curl', '-f', 'http://localhost:8080/health']},
            },
            'proxy': {'image': 'caddy:2-alpine'},
            'lgtm': {'image': 'grafana/otel-lgtm', 'profiles': ['lgtm']},
        }}
        objects = manifests(config, 'macro-kube-example', 1)
        deployments = {o['metadata']['name']: o for o in objects if o['kind'] == 'Deployment'}
        self.assertNotIn('lgtm', deployments)
        gateway = deployments['connection-gateway']['spec']['template']['spec']['containers'][0]
        self.assertEqual(gateway['args'], ['/app/out/connection_gateway'])
        self.assertEqual(gateway['env'], [{'name': 'UPSTREAM', 'value': 'http://connection-gateway:8080'}])
        self.assertEqual(gateway['readinessProbe']['exec']['command'], ['curl', '-f', 'http://localhost:8080/health'])
        services = [o for o in objects if o['kind'] == 'Service']
        public = [o for o in services if o['spec'].get('type') == 'NodePort']
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]['spec']['ports'][0], {'port': 443, 'targetPort': 32444, 'nodePort': 30444})
        self.assertEqual(len([o for o in services if o['metadata']['name'] == 'connection-gateway']), 1)

    def test_backing_volume_survives_deployment_replacement(self):
        config = {'name': 'macro-example', 'services': {'postgres': {
            'image': 'postgres:18', 'stop_grace_period': '2m0s', 'volumes': [{'type': 'volume', 'source': 'db_data', 'target': '/var/lib/postgresql'}],
        }}}
        objects = manifests(config, 'macro-kube-example', 0)
        claim = next(o for o in objects if o['kind'] == 'PersistentVolumeClaim')
        self.assertEqual(claim['metadata']['namespace'], 'macro-kube-example')
        self.assertEqual(claim['metadata']['name'], 'db-data')
        deployment = next(o for o in objects if o['kind'] == 'Deployment')
        self.assertEqual(deployment['spec']['strategy'], {'type': 'Recreate'})
        self.assertEqual(deployment['spec']['template']['spec']['terminationGracePeriodSeconds'], 120)
        self.assertEqual(deployment['spec']['template']['spec']['volumes'][0]['persistentVolumeClaim'], {'claimName': 'db-data'})

    def test_worker_state_is_namespaced_despite_shared_source_mounts(self):
        config = {'name': 'macro-example', 'services': {
            'ai_editing_worker': {'image': 'worker:dev'},
            'analytics_proxy': {'image': 'analytics:dev'},
        }}
        for namespace in ['macro-kube-one', 'macro-kube-two']:
            objects = manifests(config, namespace, 0)
            claims = [o for o in objects if o['kind'] == 'PersistentVolumeClaim']
            self.assertEqual(len(claims), 2)
            self.assertEqual({o['metadata']['namespace'] for o in claims}, {namespace})
            deployments = [o for o in objects if o['kind'] == 'Deployment']
            paths = {o['spec']['template']['spec']['containers'][0]['volumeMounts'][0]['mountPath'] for o in deployments}
            self.assertEqual(paths, {'/app/services/ai-editing-worker/.wrangler', '/app/services/analytics-proxy/.wrangler'})
            worker = next(o for o in deployments if o['metadata']['name'] == 'ai-editing-worker')['spec']['template']['spec']
            self.assertEqual(worker['volumes'][-1], {'name': 'worker-config', 'emptyDir': {}})
            self.assertEqual(worker['initContainers'][0]['command'], ['sh', '-c', 'touch /config/dev.vars'])
            self.assertEqual(worker['containers'][0]['volumeMounts'][-1]['subPath'], 'dev.vars')

    def test_fusionauth_seeds_image_defaults_without_overwriting_existing_config(self):
        config = {'name': 'macro-example', 'services': {'fusionauth': {
            'image': 'fusionauth:local', 'volumes': [{'type': 'volume', 'source': 'config',
                'target': '/usr/local/fusionauth/config'}]}, 'db': {'image': 'postgres:local'}}}
        objects = manifests(config, 'macro-kube-example', 0)
        pod = next(o for o in objects if o['kind'] == 'Deployment')['spec']['template']['spec']
        seed = pod['initContainers'][0]
        self.assertEqual(seed['volumeMounts'][0]['mountPath'], '/config')
        self.assertIn('test -f /config/fusionauth.properties || cp -a', seed['command'][-1])
        database = next(o for o in objects if o['kind'] == 'Service' and o['metadata']['name'] == 'db')
        self.assertEqual(database['spec']['ports'][0]['port'], 5432)


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Configure the optional, task-local Stalwart interoperability server.

Uses Stalwart 1.1's documented JMAP configuration API. No ACME or public DNS
changes are requested. All passwords belong to disposable loopback fixtures.
"""
import base64
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
COMPOSE = ['docker', 'compose', '-p', 'macro-imap-lab', '-f', str(HERE / 'compose.yaml'), '--profile', 'stalwart']
URL = 'http://127.0.0.1:36880/jmap/'
ADMIN = 'admin@example.net'
PASSWORD = 'lab-admin-pass'


def call(method, args, user=ADMIN, password=PASSWORD):
    payload = {'using': ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'], 'methodCalls': [[method, args, 'c1']]}
    req = urllib.request.Request(URL, json.dumps(payload).encode(), {
        'Authorization': 'Basic ' + base64.b64encode(f'{user}:{password}'.encode()).decode(),
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        name, result, _ = json.load(response)['methodResponses'][0]
    if name == 'error' or any(result.get(key) for key in ('notCreated', 'notUpdated', 'notDestroyed')):
        # Error responses contain validation details; never echo submitted credentials.
        raise RuntimeError(f'{method} failed: {result}')
    return result


def wait_ready(user=ADMIN, password=PASSWORD):
    deadline = time.monotonic() + 60
    while True:
        try:
            return call('x:Domain/get', {}, user, password)
        except (OSError, urllib.error.HTTPError) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code == 401:
                raise
            if time.monotonic() >= deadline:
                raise
            time.sleep(.25)


def main():
    subprocess.run(COMPOSE + ['up', '-d', 'stalwart'], check=True)
    # New instances expose only Bootstrap; an already configured lab is reusable.
    try:
        domains = wait_ready()
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
        result = call('x:Bootstrap/set', {'update': {'singleton': {
            'defaultHostname': 'maillab.example.net', 'defaultDomain': 'example.net',
            'requestTlsCertificate': False, 'generateDkimKeys': False,
        }}}, 'lab-admin', 'pass')
        created = result['updated']['singleton']
        subprocess.run(COMPOSE + ['restart', 'stalwart'], check=True)
        wait_ready(created['username'], created['secret'])
        call('x:AccountPassword/set', {'update': {'singleton': {'currentSecret': created['secret'], 'secret': PASSWORD}}}, created['username'], created['secret'])
        domains = wait_ready()
    domain = next(item['id'] for item in domains['list'] if item['name'] == 'example.net')
    certificate_created = not call('x:Certificate/get', {})['list']
    if certificate_created:
        call('x:Certificate/set', {'create': {'lab': {
            'certificate': {'@type': 'Text', 'value': (HERE / 'generated/server.pem').read_text()},
            'privateKey': {'@type': 'Text', 'secret': (HERE / 'generated/server.key').read_text()},
        }}})
    existing = {item['name'] for item in call('x:Account/get', {})['list']}
    for name in ('stalwart-alice', 'stalwart-bob'):
        if name not in existing:
            call('x:Account/set', {'create': {name: {
                '@type': 'User', 'name': name, 'domainId': domain,
                'credentials': {'0': {'@type': 'Password', 'secret': 'lab-mail-pass'}},
            }}})
    if certificate_created:
        subprocess.run(COMPOSE + ['restart', 'stalwart'], check=True)
        wait_ready()
    print('Stalwart lab configured: two isolated synthetic accounts and the local TLS certificate')


if __name__ == '__main__':
    main()

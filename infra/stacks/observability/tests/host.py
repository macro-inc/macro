#!/usr/bin/env python3
"""Test disk safety; optionally exercise startup with isolated user systemd units."""
import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid


ASSETS = Path(__file__).resolve().parents[1] / 'assets'


def run(*args, check=True, **kwargs):
    return subprocess.run(args, check=check, text=True, capture_output=True,
                          timeout=20, **kwargs)


def volume_checks():
    bash = shutil.which('bash')
    assert bash, 'bash is required'
    with tempfile.TemporaryDirectory(prefix='observability-volume-test-') as directory:
        root = Path(directory)
        scripts = {
            'blkid': 'printf "%s" "$TEST_FILESYSTEM"\n'
                     'if [ -z "$TEST_FILESYSTEM" ]; then exit 2; fi\n',
            'wipefs': 'printf "%s" "$TEST_SIGNATURES"\nexit "$TEST_WIPEFS_EXIT"\n',
            'mkfs.ext4': 'printf "%s\\n" "$1" >> "$TEST_FORMAT_LOG"\n',
        }
        for name, script in scripts.items():
            executable = root / name
            executable.write_text(f'#!{bash}\n{script}')
            executable.chmod(0o700)
        device = str(root / 'fake-device')
        cases = [
            ('fresh volume', '', '', 0, True, True),
            ('existing ext4', 'ext4', '', 0, True, False),
            ('unknown filesystem', 'xfs', '', 0, False, False),
            ('partition signature', '', 'gpt', 0, False, False),
            ('failed signature inspection', '', '', 1, False, False),
        ]
        for name, filesystem, signatures, wipefs_exit, succeeds, formats in cases:
            log = root / 'formatted'
            log.unlink(missing_ok=True)
            result = run(bash, str(ASSETS / 'prepare-volume.sh'), device,
                         check=False, env={
                             **os.environ,
                             # No fallback to real disk utilities is possible.
                             'PATH': directory,
                             'TEST_FILESYSTEM': filesystem,
                             'TEST_SIGNATURES': signatures,
                             'TEST_WIPEFS_EXIT': str(wipefs_exit),
                             'TEST_FORMAT_LOG': str(log),
                         })
            assert (result.returncode == 0) == succeeds, (name, result.stderr)
            assert log.exists() == formats, name
            if formats:
                assert log.read_text() == device + '\n', name
            print('PASS:', name)


def unit_settings(path):
    flake = ASSETS.parent
    unit = path.rsplit('/', 1)[-1]
    source = run('nix', 'eval', '--raw',
                 f'path:{flake}#nixosConfigurations.observability.config.systemd.units."{unit}".text').stdout
    settings = {}
    for line in source.splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            settings.setdefault(key, []).append(value)
    return settings


def eventually(check, description):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError('Timed out: ' + description)


def systemd_checks():
    # Read relationships from the deployed units, replacing only host-specific
    # mounts, commands and the Docker name. No real Docker daemon is touched.
    app_settings = unit_settings('/etc/systemd/system/observability.service')
    docker_settings = unit_settings('/etc/systemd/system/docker.service')
    collector_settings = unit_settings('/etc/systemd/system/alloy.service')
    cloudwatch_settings = unit_settings('/etc/systemd/system/amazon-cloudwatch-agent.service')
    assert cloudwatch_settings['User'] == ['cloudwatch-agent']
    assert all('docker.service' not in value for key in ['Requires', 'After', 'PartOf']
               for value in cloudwatch_settings.get(key, []))
    assert collector_settings['ExecStartPre'] == app_settings['ExecStartPre'][:1]
    assert docker_settings['Upholds'] == ['observability.service', 'alloy.service']
    assert docker_settings['StartLimitIntervalSec'] == ['0']
    assert any('pre-start' in command for command in docker_settings['ExecStartPre'])
    assert app_settings['ExecStartPre'][0].endswith('/bin/mountpoint -q /srv/observability')
    assert app_settings['ExecStartPre'][1].endswith('-refresh-secrets.py')
    assert app_settings['StartLimitIntervalSec'] == ['0']

    prefix = 'observability-test-' + uuid.uuid4().hex
    docker = prefix + '-docker.service'
    app = prefix + '-app.service'
    collector = prefix + '-collector.service'
    bash = shutil.which('bash')
    sleep = shutil.which('sleep')
    assert bash and sleep, 'bash and sleep are required'

    def state(unit, property_name):
        return run('systemctl', '--user', 'show', unit,
                   '--property=' + property_name, '--value').stdout.strip()

    with tempfile.TemporaryDirectory(prefix=prefix) as directory:
        root = Path(directory)
        outage = root / 'secret-outage'
        storage_outage = root / 'storage-outage'
        events = root / 'events'
        collector_events = root / 'collector-events'
        outage.touch()
        storage_outage.touch()

        def command(script):
            return shlex.join([bash, '-c', script])

        def starts():
            return events.read_text().splitlines().count('start') if events.exists() else 0

        def collector_starts():
            return len(collector_events.read_text().splitlines()) if collector_events.exists() else 0

        def active():
            return state(app, 'ActiveState') == 'active'

        try:
            run('systemd-run', '--user', '--no-block', '--unit=' + docker,
                '--property=Restart=always', '--property=RestartSec=0.2s',
                '--property=StartLimitIntervalSec=0',
                '--property=Upholds=' + app + ' ' + collector,
                '--property=ExecStartPre=' + command('test ! -e ' + shlex.quote(str(storage_outage))),
                sleep, '120')
            collector_properties = []
            for key in ['Requires', 'After', 'PartOf', 'Restart', 'RestartSec']:
                for value in collector_settings.get(key, []):
                    if key in ['Requires', 'After', 'PartOf']:
                        value = ' '.join(docker if name == 'docker.service' else name
                                         for name in value.split() if name != 'network.target')
                    if key == 'RestartSec':
                        value = '0.1s'
                    collector_properties.append(f'--property={key}={value}')
            run('systemd-run', '--user', '--no-block', '--unit=' + collector,
                *collector_properties, bash, '-c',
                'echo start >> ' + shlex.quote(str(collector_events)) + '; exec ' + shlex.quote(sleep) + ' 120')
            properties = []
            for key in ['Requires', 'After', 'PartOf', 'StartLimitIntervalSec',
                        'Type', 'RemainAfterExit', 'Restart', 'RestartSec']:
                for value in app_settings.get(key, []):
                    if key in ['Requires', 'After', 'PartOf']:
                        value = ' '.join(docker if name == 'docker.service' else name
                                         for name in value.split()
                                         if name != 'network-online.target')
                    if key == 'RestartSec':
                        value = '0.1s'
                    properties.append(f'--property={key}={value}')
            run('systemd-run', '--user', '--no-block', '--unit=' + app,
                *properties,
                '--property=ExecStartPre=' + command('test ! -e ' + shlex.quote(str(outage))),
                '--property=ExecStop=' + command('echo stop >> ' + shlex.quote(str(events))),
                bash, '-c', 'echo start >> ' + shlex.quote(str(events)))
            eventually(lambda: int(state(docker, 'NRestarts')) >= 4,
                       'Docker retries late metadata/storage')
            assert starts() == collector_starts() == 0, 'Started before storage was ready'
            storage_outage.unlink()
            eventually(lambda: int(state(app, 'NRestarts')) >= 6,
                       'secret fetch continues retrying')
            eventually(lambda: collector_starts() == 1, 'collector starts after late storage recovery')
            print('PASS: late storage recovery starts dependent stack and host collector automatically')
            assert starts() == 0, 'Started before secrets were available'
            outage.unlink()
            eventually(lambda: active() and starts() == 1, 'secret outage recovery')
            print('PASS: secret outage recovers automatically')

            run('systemctl', '--user', 'restart', docker)
            eventually(lambda: active() and starts() == 2, 'intentional Docker restart')
            eventually(lambda: collector_starts() == 2, 'collector restarts with Docker')
            print('PASS: intentional Docker restart restarts observability and host collection')

            run('systemctl', '--user', 'kill', '--kill-whom=main',
                '--signal=SIGKILL', docker)
            eventually(lambda: active() and starts() == 3, 'Docker crash recovery')
            assert int(state(docker, 'NRestarts')) >= 1
            assert events.read_text().splitlines() == ['start', 'stop', 'start', 'stop', 'start']
            eventually(lambda: collector_starts() == 3, 'collector recovers after Docker crash')
            print('PASS: Docker crash restarts observability and host collection')
        except BaseException:
            print(run('journalctl', '--user', '-u', docker, '-u', app, '-u', collector,
                      '--no-pager', '-n', '60', check=False).stdout)
            raise
        finally:
            # Stop only this invocation's UUID-named units. Inactive transient
            # units may already have been unloaded, so cleanup is best effort.
            run('systemctl', '--user', 'stop', app, collector, docker, check=False)
            run('systemctl', '--user', 'reset-failed', app, collector, docker, check=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--systemd', action='store_true',
                        help='also create isolated transient units in the user manager')
    arguments = parser.parse_args()
    volume_checks()
    if arguments.systemd:
        systemd_checks()

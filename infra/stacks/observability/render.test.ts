import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { renderUserData } from './render';
import {
  validateRegion,
  validateRegionalArn,
  validateSettings,
  type Settings,
} from './settings';

const fixture: Settings = {
  region: 'us-east-2',
  grafanaHost: 'grafana-dev.macro.com',
  otlpHost: 'otlp-dev.macro.com',
  allowedEmails: ['reader@macro.com', 'admin@macro.com'],
  adminEmails: ['admin@macro.com'],
  secretArn:
    'arn:aws:secretsmanager:us-east-2:123456789012:secret:observability-test',
  volumeId: 'vol-0123456789abcdef0',
  logsBucket: 'observability-logs-test',
  tracesBucket: 'observability-traces-test',
};

test('invalid access lists and config injection fail closed', () => {
  for (const change of [
    { allowedEmails: [] },
    { adminEmails: [] },
    { adminEmails: ['unapproved@macro.com'] },
    { allowedEmails: ['outside@gmail.com'] },
    { allowedEmails: ["x' || 'GrafanaAdmin'@macro.com"] },
    { grafanaHost: 'macro.com\nfoo' },
    { otlpHost: fixture.grafanaHost },
    { secretArn: 'not-an-arn' },
    { secretArn: fixture.secretArn.replace('us-east-2', 'us-east-1') },
    { region: 'us-east-1' },
  ]) {
    expect(() => validateSettings({ ...fixture, ...change })).toThrow();
  }
});

test('regional dependencies stay outside the production region', () => {
  expect(() => validateSettings(fixture)).not.toThrow();
  expect(() => validateRegion('us-east-1')).toThrow();
  expect(() =>
    validateRegionalArn(
      'arn:aws:sns:us-east-2:123456789012:alarms',
      'sns',
      fixture.region
    )
  ).not.toThrow();
  expect(() =>
    validateRegionalArn(
      'arn:aws:sns:us-east-1:123456789012:alarms',
      'sns',
      fixture.region
    )
  ).toThrow();
});

test('EC2 user data fits its limit and contains only versioned configuration', () => {
  const compressed = Buffer.from(renderUserData(fixture), 'base64');
  expect(compressed.length).toBeLessThan(16384);
  const data = gunzipSync(compressed).toString();
  expect(data).not.toContain('@@');
  const payload = JSON.parse(data);
  expect(Object.keys(payload).sort()).toEqual(['settings', 'version']);
  expect(payload.version).toBe(3);
  expect(payload.settings).toEqual(fixture);
});

test('volume preparation refuses inspection failures and existing signatures', () => {
  const result = spawnSync('python3', [join(__dirname, 'tests', 'host.py')], {
    stdio: 'inherit',
  });
  expect(result.status).toBe(0);
});

test('NixOS accepts only the expected IMDSv2 configuration', () => {
  const result = spawnSync(
    'python3',
    [join(__dirname, 'tests', 'user-data.py')],
    {
      stdio: 'inherit',
    }
  );
  expect(result.status).toBe(0);
});

test.skipIf(process.env.OBSERVABILITY_SYSTEMD !== '1')(
  'systemd recovers from secret outages and daemon restarts',
  () => {
    const result = spawnSync(
      'python3',
      [join(__dirname, 'tests', 'host.py'), '--systemd'],
      {
        stdio: 'inherit',
        timeout: 30_000,
      }
    );
    expect(result.status).toBe(0);
  },
  35_000
);

const smokeTimeout =
  process.env.OBSERVABILITY_COLLECTORS === '1' ? 600_000 : 240_000;

// Explicit opt-in: creates an isolated Docker project with fake credentials.
test.skipIf(process.env.OBSERVABILITY_SMOKE !== '1')(
  'authentication, all three signals, S3 flush and restart recovery',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'observability-smoke-'));
    try {
      writeFileSync(
        join(directory, 'user-data.json'),
        gunzipSync(Buffer.from(renderUserData(fixture), 'base64'))
      );
      const result = spawnSync(
        'python3',
        [join(__dirname, 'tests', 'smoke.py'), directory],
        {
          stdio: 'inherit',
          timeout: smokeTimeout,
        }
      );
      expect(result.status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  smokeTimeout + 10_000
);

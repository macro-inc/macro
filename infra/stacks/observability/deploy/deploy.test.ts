import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  type StackResources,
  replacementChecks,
  principalArnOf,
  stackResources,
} from './iam-preflight';
import { IMAGE_INPUTS, imageFiles, imageSourceKey } from './image-key';
import { DURABLE, INSTANCE, checkPlan, resourceOf } from './plan';
import { imageFile } from './publish';
import {
  SMOKE_ALARM_TOPIC,
  SMOKE_PREFIX,
  UNITS,
  hostCheckScript,
  smokeHostPolicy,
  smokeNames,
  smokeSecret,
  smokeUserData,
} from './smoke';

const stackDir = resolve(import.meta.dir, '..');
const urn = (type: string, name: string, parent = '') =>
  `urn:pulumi:prod::observability::${parent}${type}::${name}`;
const step = (op: string, id: string) => {
  const [type, name] = id.split('::');
  return { op, urn: urn(type, name) };
};
const unchanged = [...DURABLE].map((id) => step('same', id));

describe('image source key', () => {
  function repo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'image-key-'));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    return dir;
  }
  const base = {
    'flake.nix': '{ }',
    'flake.lock': '{}',
    'nixos/host.nix': '{ }',
    'assets/prepare-volume.sh': 'true',
    'index.ts': 'export {}',
    'README.md': '# docs',
    'nixos/database-collector/host.nix': '{ }',
  };

  test('changes with the image source only', () => {
    const dir = repo(base);
    const key = imageSourceKey(dir);
    writeFileSync(join(dir, 'README.md'), '# other docs');
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1;');
    writeFileSync(join(dir, 'nixos/database-collector/host.nix'), '{ a = 1; }');
    writeFileSync(join(dir, 'nixos/untracked.nix'), '{ }');
    expect(imageSourceKey(dir)).toBe(key);
    writeFileSync(join(dir, 'nixos/host.nix'), '{ b = 1; }');
    expect(imageSourceKey(dir)).not.toBe(key);
  });

  test('a renamed file changes the key', () => {
    const dir = repo(base);
    const key = imageSourceKey(dir);
    execFileSync('git', ['mv', 'nixos/host.nix', 'nixos/other.nix'], {
      cwd: dir,
    });
    expect(imageSourceKey(dir)).not.toBe(key);
  });

  test("covers every path the image's Nix files read", () => {
    const tracked = new Set(imageFiles(stackDir));
    const nixFiles = [...tracked].filter((path) => path.endsWith('.nix'));
    expect(nixFiles).toContain('nixos/host.nix');
    for (const file of ['flake.nix', ...nixFiles]) {
      const source = readFileSync(join(stackDir, file), 'utf8');
      for (const [reference] of source.matchAll(/\.\.?\/[\w./-]+/g)) {
        const target = relative(
          stackDir,
          resolve(stackDir, dirname(file), reference)
        );
        // The other image in this flake is not part of this one.
        if (
          file === 'flake.nix' &&
          target.startsWith('nixos/database-collector/')
        ) {
          continue;
        }
        expect(
          IMAGE_INPUTS.some(
            (input) => target === input || target.startsWith(`${input}/`)
          ),
          `${file} reads ${target}, outside the image inputs`
        ).toBe(true);
        expect(
          tracked.has(target) || existsDirectory(target),
          `${file} reads ${target}`
        ).toBe(true);
      }
    }
  });

  function existsDirectory(path: string): boolean {
    try {
      readdirSync(join(stackDir, path));
      return true;
    } catch {
      return false;
    }
  }
});

describe('plan check', () => {
  const imageChange = [
    ...unchanged,
    step('replace', INSTANCE),
    step(
      'replace',
      'aws:ec2/volumeAttachment:VolumeAttachment::observability-data'
    ),
    step(
      'replace',
      'aws:lb/targetGroupAttachment:TargetGroupAttachment::observability'
    ),
    step(
      'replace',
      'aws:lb/targetGroupAttachment:TargetGroupAttachment::observability-oncall'
    ),
    step(
      'update',
      'aws:cloudwatch/metricAlarm:MetricAlarm::observability-instance'
    ),
    step('update', 'pulumi:pulumi:Stack::observability-prod'),
    step('same', 'aws:ec2/vpc:Vpc::observability'),
  ];

  test('applies an image change', () => {
    const plan = checkPlan({ steps: imageChange });
    expect(plan.refused).toEqual([]);
    expect(plan.changes).toHaveLength(6);
    expect(plan.instanceUrn).toBe(
      urn('aws:ec2/instance:Instance', 'observability')
    );
  });

  test('has nothing to do when production is current', () => {
    const plan = checkPlan({ steps: [...unchanged, step('same', INSTANCE)] });
    expect(plan.refused).toEqual([]);
    expect(plan.changes).toEqual([]);
  });

  test.each([
    ['update', 'aws:ec2/securityGroup:SecurityGroup::observability-host'],
    ['create', 'aws:s3/bucketV2:BucketV2::observability-extra'],
    ['update', 'aws:iam/rolePolicy:RolePolicy::observability-storage'],
    ['replace', 'aws:ebs/volume:Volume::observability-data'],
    ['update', 'aws:s3/bucketV2:BucketV2::observability-logs'],
    ['delete', 'aws:cloudwatch/metricAlarm:MetricAlarm::observability-memory'],
    ['create', 'aws:ec2/instance:Instance::observability-second'],
  ])('refuses %s %s', (op, id) => {
    const steps = [
      ...imageChange.filter((entry) => {
        const { type, name } = resourceOf(entry.urn);
        return `${type}::${name}` !== id;
      }),
      step(op, id),
    ];
    expect(checkPlan({ steps }).refused).not.toEqual([]);
  });

  test('refuses a plan that omits the retained storage', () => {
    const plan = checkPlan({ steps: [step('replace', INSTANCE)] });
    expect(plan.refused.join('\n')).toContain('observability-data');
  });

  test('the deploy step previews with unchanged resources listed', () => {
    // Without --show-sames the JSON omits them and every plan is refused.
    const source = readFileSync(join(import.meta.dir, 'release.ts'), 'utf8');
    expect(source).toContain("'--json', '--show-sames'");
  });

  test('reads types under a parent', () => {
    const plan = checkPlan({
      steps: [
        ...unchanged,
        {
          op: 'replace',
          urn: urn(
            'aws:ec2/instance:Instance',
            'observability',
            'my:component$'
          ),
        },
      ],
    });
    expect(plan.refused).toEqual([]);
  });
});

describe('smoke boot', () => {
  const names = smokeNames('42135788731-2');
  const target = {
    instanceProfile: names.role,
    secretArn: `arn:aws:secretsmanager:us-east-2:569036502058:secret:${names.secret}-AbCdEf`,
    logsBucket: names.logsBucket,
    tracesBucket: names.tracesBucket,
  };

  test('names every resource after the run, inside the sweep prefixes', () => {
    expect(names).toEqual({
      role: 'observability-smoke-42135788731-2',
      logsBucket: 'observability-smoke-42135788731-2-logs',
      tracesBucket: 'observability-smoke-42135788731-2-traces',
      secret: 'observability/smoke-42135788731-2',
    });
    for (const bucket of [names.logsBucket, names.tracesBucket]) {
      expect(bucket).toMatch(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
      expect(bucket.startsWith(SMOKE_PREFIX)).toBe(true);
    }
    expect(() => smokeNames('../x')).toThrow();
  });

  test('the smoke host may reach only its own buckets and secret', () => {
    const policy = JSON.stringify(
      smokeHostPolicy(names.logsBucket, names.tracesBucket, target.secretArn)
    );
    const resources = [...policy.matchAll(/"arn:aws:[^"]+"/g)].map(
      (match) => match[0]
    );
    for (const arn of resources) {
      expect(
        arn.includes(names.logsBucket) ||
          arn.includes(names.tracesBucket) ||
          arn.includes(names.secret),
        arn
      ).toBe(true);
    }
    expect(policy).not.toMatch(
      /cloudwatch|sns:|"\*"|observability-logs|observability-traces/
    );
  });

  test('cleanup removes every kind of resource the smoke boot creates', () => {
    const source = readFileSync(join(import.meta.dir, 'smoke.ts'), 'utf8');
    const pairs: [string, string][] = [
      ["'create-bucket'", "'rb'"],
      ["'create-secret'", "'delete-secret'"],
      ["'create-role'", "'delete-role'"],
      ["'put-role-policy'", "'delete-role-policy'"],
      ["'attach-role-policy'", "'detach-role-policy'"],
      ["'create-instance-profile'", "'delete-instance-profile'"],
      ["'add-role-to-instance-profile'", "'remove-role-from-instance-profile'"],
      ["'create-volume'", "'delete-volume'"],
      ["'run-instances'", "'terminate-instances'"],
    ];
    const created = [
      ...source.matchAll(
        /'(create-[a-z-]+|run-instances|put-role-policy|attach-role-policy|add-role-to-instance-profile)'/g
      ),
    ].map((match) => `'${match[1]}'`);
    for (const call of new Set(created)) {
      const pair = pairs.find(([create]) => create === call);
      expect(pair, `no cleanup for ${call}`).toBeDefined();
      expect(source).toContain(pair?.[1] ?? '');
    }
  });

  test('user data points only at smoke storage and a topic nobody reads', () => {
    const payload = JSON.parse(
      gunzipSync(
        Buffer.from(smokeUserData(target, 'vol-0abc'), 'base64')
      ).toString()
    );
    expect(payload.settings).toMatchObject({
      volumeId: 'vol-0abc',
      logsBucket: target.logsBucket,
      tracesBucket: target.tracesBucket,
      secretArn: target.secretArn,
      alarmTopicArn: SMOKE_ALARM_TOPIC,
    });
    expect(JSON.stringify(payload)).not.toContain('grafana.macro-internal.com');
    // The host's own validator accepts it.
    const source = readFileSync(
      join(stackDir, 'nixos/read-user-data.py'),
      'utf8'
    );
    expect(source).toContain(`payload['version'] != ${payload.version}`);
  });

  test('the throwaway secret has exactly the fields the host validates, and no paging keys', () => {
    const source = readFileSync(
      join(stackDir, 'assets/refresh-secrets.py'),
      'utf8'
    );
    const block = /keys = \[([^\]]+)\]/.exec(source)?.[1] ?? '';
    const required = [...block.matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1]
    );
    const secret = smokeSecret();
    expect(Object.keys(secret).sort()).toEqual(required.sort());
    for (const value of Object.values(secret)) {
      expect(value).not.toMatch(/\s/);
    }
    for (const key of [
      'grafana_secret_key',
      'otlp_token',
      'goalert_encryption_key',
      'goalert_admin_password',
    ]) {
      expect(secret[key].length).toBeGreaterThanOrEqual(32);
    }
    expect(secret.macro_alerts_webhook_url).toStartWith('https://');
    expect(
      Object.keys(secret).some((key) => key.includes('integration_key'))
    ).toBe(false);
  });

  test('the host check is valid shell and covers every unit', () => {
    const script = hostCheckScript('0123456789abcdef0123456789abcdef');
    execFileSync('bash', ['-n'], { input: script });
    for (const unit of UNITS) expect(script).toContain(unit);
    // Every unit the README tells operators to check.
    const readme = readFileSync(join(stackDir, 'README.md'), 'utf8');
    const listed =
      /systemctl status ([a-z -]+)\n/.exec(readme)?.[1].split(' ') ?? [];
    expect(listed.length).toBeGreaterThan(5);
    for (const unit of listed) expect(UNITS).toContain(unit);
  });
});

const stack: StackResources = {
  instanceArn: 'arn:aws:ec2:us-east-2:569036502058:instance/i-0abc',
  instanceId: 'i-0abc',
  subnetId: 'subnet-0abc',
  securityGroupIds: ['sg-0abc'],
  availabilityZone: 'us-east-2a',
  volumeArn: 'arn:aws:ec2:us-east-2:569036502058:volume/vol-0abc',
  hostRoleArn: 'arn:aws:iam::569036502058:role/observability-host-1a2b3c4',
  targetGroupArns: [
    'arn:aws:elasticloadbalancing:us-east-2:569036502058:targetgroup/observability-1a2b3c4/0123456789abcdef',
  ],
  alarmArns: [
    'arn:aws:cloudwatch:us-east-2:569036502058:alarm:observability-instance-1a2b3c4',
  ],
};

describe('preflight helpers', () => {
  test('reads the stack export', () => {
    const resource = (
      type: string,
      name: string,
      outputs: Record<string, unknown>
    ) => ({
      type,
      urn: urn(type, name),
      outputs,
    });
    const resources = stackResources({
      deployment: {
        resources: [
          resource('aws:ec2/instance:Instance', 'observability', {
            arn: stack.instanceArn,
            id: stack.instanceId,
            subnetId: stack.subnetId,
            vpcSecurityGroupIds: stack.securityGroupIds,
            availabilityZone: stack.availabilityZone,
          }),
          resource('aws:ebs/volume:Volume', 'observability-data', {
            arn: stack.volumeArn,
          }),
          resource('aws:iam/role:Role', 'observability-host', {
            arn: stack.hostRoleArn,
          }),
          resource('aws:iam/role:Role', 'observability-snapshots', {
            arn: 'other',
          }),
          resource('aws:lb/targetGroup:TargetGroup', 'observability', {
            arn: stack.targetGroupArns[0],
          }),
          resource(
            'aws:cloudwatch/metricAlarm:MetricAlarm',
            'observability-instance',
            {
              arn: stack.alarmArns[0],
            }
          ),
        ],
      },
    });
    expect(resources).toEqual(stack);
  });

  test('checks every call a replacement makes, on the real resources', () => {
    const checks = replacementChecks(stack, 'ami-0123');
    const on = (action: string) =>
      checks
        .filter((check) => check.action === action)
        .flatMap((check) => check.resources);
    expect(on('ec2:StopInstances')).toEqual([stack.instanceArn]);
    expect(on('ec2:DetachVolume')).toEqual([
      stack.instanceArn,
      stack.volumeArn,
    ]);
    expect(on('ec2:TerminateInstances')).toEqual([stack.instanceArn]);
    expect(on('ec2:RunInstances')).toContain(
      'arn:aws:ec2:us-east-2::image/ami-0123'
    );
    expect(on('ec2:AttachVolume')).toContain(stack.volumeArn);
    expect(on('iam:PassRole')).toEqual([stack.hostRoleArn]);
    expect(on('elasticloadbalancing:RegisterTargets')).toEqual(
      stack.targetGroupArns
    );
    expect(on('elasticloadbalancing:DeregisterTargets')).toEqual(
      stack.targetGroupArns
    );
    expect(on('cloudwatch:PutMetricAlarm')).toEqual(stack.alarmArns);
  });

  test('simulates the calling user, or an assumed role', () => {
    expect(principalArnOf('arn:aws:iam::569036502058:user/deploy')).toBe(
      'arn:aws:iam::569036502058:user/deploy'
    );
    expect(
      principalArnOf('arn:aws:sts::569036502058:assumed-role/some-role/session')
    ).toBe('arn:aws:iam::569036502058:role/some-role');
    expect(() =>
      principalArnOf('arn:aws:sts::569036502058:federated-user/x')
    ).toThrow();
  });

  test('publish accepts only a UEFI x86_64 VHD', () => {
    const dir = mkdtempSync(join(tmpdir(), 'image-'));
    mkdirSync(join(dir, 'nix-support'));
    const info = (value: object) =>
      writeFileSync(
        join(dir, 'nix-support/image-info.json'),
        JSON.stringify(value)
      );
    info({
      system: 'x86_64-linux',
      boot_mode: 'uefi',
      file: '/nix/store/x/disk.vhd',
    });
    expect(imageFile(dir)).toBe(join(dir, 'disk.vhd'));
    info({
      system: 'x86_64-linux',
      boot_mode: 'legacy-bios',
      file: 'disk.vhd',
    });
    expect(() => imageFile(dir)).toThrow();
    info({ system: 'x86_64-linux', boot_mode: 'uefi', file: 'disk.qcow2' });
    expect(() => imageFile(dir)).toThrow();
  });
});

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
import { deployStatements } from '../../observability-deploy/policy';
import {
  type StackResources,
  replacementChecks,
  roleArnOf,
  stackResources,
} from './iam-preflight';
import { IMAGE_INPUTS, imageFiles, imageSourceKey } from './image-key';
import { DURABLE, INSTANCE, checkPlan, resourceOf } from './plan';
import { imageFile } from './publish';
import {
  SMOKE_ALARM_TOPIC,
  SMOKE_PROJECT_TAG,
  UNITS,
  hostCheckScript,
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
  const target = {
    ami: 'ami-0123456789abcdef0',
    subnetId: 'subnet-1',
    securityGroupId: 'sg-1',
    availabilityZone: 'us-east-2a',
    instanceProfile: 'macro-observability-smoke-host',
    secretArn:
      'arn:aws:secretsmanager:us-east-2:569036502058:secret:observability/smoke-AbCdEf',
    logsBucket: 'observability-smoke-logs-1234567',
    tracesBucket: 'observability-smoke-traces-1234567',
    runId: '1-1',
  };

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

describe('deploy role', () => {
  const statements = deployStatements({
    account: '569036502058',
    region: 'us-east-2',
    imageBucket: 'macro-observability-images-569036502058-us-east-2',
    importRole: 'macro-observability-vmimport',
    smokeTag: SMOKE_PROJECT_TAG,
    smokeRoleArn:
      'arn:aws:iam::569036502058:role/macro-observability-smoke-host',
    smokeSecretArn:
      'arn:aws:secretsmanager:us-east-2:569036502058:secret:observability/smoke-AbCdEf',
  });
  const glob = (pattern: string) =>
    new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      'i'
    );
  const list = (value: string | string[]) =>
    Array.isArray(value) ? value : [value];
  const grants = (action: string, resource = '*') =>
    statements.some(
      (statement) =>
        list(statement.Action).some((pattern) => glob(pattern).test(action)) &&
        list(statement.Resource).some(
          (pattern) => resource === '*' || glob(pattern).test(resource)
        )
    );

  test('grants every call a replacement makes, on the stack resources', () => {
    for (const check of replacementChecks(stack, 'ami-0123')) {
      for (const resource of check.resources) {
        expect(
          grants(check.action, resource),
          `${check.action} on ${resource}`
        ).toBe(true);
      }
    }
  });

  test('grants every AWS CLI call the deploy scripts make', () => {
    const special: Record<string, string> = {
      's3api get-public-access-block': 's3:GetBucketPublicAccessBlock',
      's3api get-bucket-location': 's3:GetBucketLocation',
    };
    const services: Record<string, string> = {
      s3api: 's3',
      elbv2: 'elasticloadbalancing',
    };
    const waits: Record<string, string> = {
      'instance-running': 'ec2:DescribeInstances',
      'instance-stopped': 'ec2:DescribeInstances',
      'instance-terminated': 'ec2:DescribeInstances',
      'volume-available': 'ec2:DescribeVolumes',
      'image-available': 'ec2:DescribeImages',
    };
    const calls = new Set<string>(['s3:PutObject']); // `aws s3 cp`
    for (const file of [
      'publish.ts',
      'smoke.ts',
      'release.ts',
      'iam-preflight.ts',
    ]) {
      const source = readFileSync(join(import.meta.dir, file), 'utf8');
      for (const [, service, command, rest] of source.matchAll(
        /aws(?:<[^(]*?>)?\(\s*[\w'-]+,\s*'([a-z0-9]+)',\s*'([a-z-]+)'(,\s*'([a-z-]+)')?/g
      )) {
        if (service === 'sts') continue;
        if (command === 'wait') {
          const action = waits[rest?.replace(/[,\s']/g, '') ?? ''];
          expect(action, `wait ${rest}`).toBeDefined();
          calls.add(action);
          continue;
        }
        const pascal = command.replace(/(^|-)([a-z])/g, (_, __, letter) =>
          letter.toUpperCase()
        );
        calls.add(
          special[`${service} ${command}`] ??
            `${services[service] ?? service}:${pascal}`
        );
      }
    }
    expect(calls.size).toBeGreaterThan(20);
    for (const action of calls) expect(grants(action), action).toBe(true);
  });

  test('cannot touch untagged instances, other volumes or the retained buckets', () => {
    const manage = statements.find(
      (statement) => statement.Sid === 'ManageHosts'
    );
    expect(manage?.Condition?.StringEquals['aws:ResourceTag/project']).toEqual([
      'observability',
      SMOKE_PROJECT_TAG,
    ]);
    const deletes = statements.filter((statement) =>
      list(statement.Action).includes('ec2:DeleteVolume')
    );
    expect(
      deletes.map(
        (statement) =>
          statement.Condition?.StringEquals['aws:ResourceTag/project']
      )
    ).toEqual([[SMOKE_PROJECT_TAG]]);
    const all = JSON.stringify(statements);
    expect(all).not.toContain('observability-logs');
    expect(all).not.toContain('observability-traces');
    expect(all).not.toMatch(/"s3:\*"|"ec2:\*"|"iam:\*"/);
  });
});

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

  test('turns an assumed-role session into its role', () => {
    expect(
      roleArnOf(
        'arn:aws:sts::569036502058:assumed-role/macro-observability-deploy/GitHubActions'
      )
    ).toBe('arn:aws:iam::569036502058:role/macro-observability-deploy');
    expect(() => roleArnOf('arn:aws:iam::569036502058:user/someone')).toThrow();
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

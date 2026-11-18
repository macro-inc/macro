// Boot a candidate AMI on a throwaway host and check every service comes up,
// before the production host is touched. The run creates the smoke host's own
// blank volume, buckets, secret of throwaway values and IAM role, and deletes
// them all afterwards. Never production storage: Loki and Tempo compactors
// delete blocks they consider expired.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderUserData } from '../render';
import { ACCOUNT, REGION, aws, sleep, waitFor } from './aws';

export const SMOKE_PROJECT_TAG = 'observability-smoke';
// The same type as production, so the check covers its boot and drivers.
const INSTANCE_TYPE = 'm7i.xlarge';

// Every smoke resource is named or tagged with these, so a sweep finds all of
// them. Rollouts never overlap, so any smoke resource left is a dead run's.
export const SMOKE_PREFIX = 'observability-smoke-';
const SMOKE_SECRET_PREFIX = 'observability/smoke-';
const SMOKE_IAM_PATH = '/observability-smoke/';

export interface SmokeTarget {
  ami: string;
  subnetId: string;
  securityGroupId: string;
  availabilityZone: string;
  /** Names this run's smoke resources (`GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT`). */
  runId: string;
}

export interface SmokeResources {
  instanceProfile: string;
  secretArn: string;
  logsBucket: string;
  tracesBucket: string;
}

export function smokeNames(runId: string) {
  if (!/^[0-9]+-[0-9]+$/.test(runId)) throw new Error(`Bad run id ${runId}`);
  const name = `${SMOKE_PREFIX}${runId}`;
  return {
    role: name,
    logsBucket: `${name}-logs`,
    tracesBucket: `${name}-traces`,
    secret: `${SMOKE_SECRET_PREFIX}${runId}`,
  };
}

/**
 * The smoke host's only permissions: its own buckets and secret. No CloudWatch,
 * SNS or production storage, so it cannot delete telemetry or page anyone.
 */
export function smokeHostPolicy(
  logsBucket: string,
  tracesBucket: string,
  secretArn: string
) {
  const buckets = [logsBucket, tracesBucket].map(
    (bucket) => `arn:aws:s3:::${bucket}`
  );
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          's3:ListBucket',
          's3:GetBucketLocation',
          's3:ListBucketMultipartUploads',
        ],
        Resource: buckets,
      },
      {
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
          's3:ListMultipartUploadParts',
        ],
        Resource: buckets.map((arn) => `${arn}/*`),
      },
      {
        Effect: 'Allow',
        Action: 'secretsmanager:GetSecretValue',
        Resource: secretArn,
      },
    ],
  };
}

const SSM_POLICY = 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore';
const smokeTagList = (runId: string) => [
  { Key: 'project', Value: SMOKE_PROJECT_TAG },
  { Key: 'SmokeRun', Value: runId },
];

/** Create this run's buckets, secret and instance profile. */
export async function createSmokeResources(
  runId: string
): Promise<SmokeResources> {
  const names = smokeNames(runId);
  for (const bucket of [names.logsBucket, names.tracesBucket]) {
    aws(
      REGION,
      's3api',
      'create-bucket',
      '--bucket',
      bucket,
      '--create-bucket-configuration',
      `LocationConstraint=${REGION}`
    );
    aws(
      REGION,
      's3api',
      'put-public-access-block',
      '--bucket',
      bucket,
      '--public-access-block-configuration',
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
    );
    aws(
      REGION,
      's3api',
      'put-bucket-tagging',
      '--bucket',
      bucket,
      '--tagging',
      JSON.stringify({ TagSet: smokeTagList(runId) })
    );
  }
  const secretArn = aws<{ ARN: string }>(
    REGION,
    'secretsmanager',
    'create-secret',
    '--name',
    names.secret,
    '--description',
    'Throwaway credentials for one observability AMI smoke boot',
    '--secret-string',
    JSON.stringify(smokeSecret()),
    '--tags',
    JSON.stringify(smokeTagList(runId))
  ).ARN;
  aws(
    REGION,
    'iam',
    'create-role',
    '--role-name',
    names.role,
    '--path',
    SMOKE_IAM_PATH,
    '--assume-role-policy-document',
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'ec2.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
    '--tags',
    JSON.stringify(smokeTagList(runId))
  );
  aws(
    REGION,
    'iam',
    'put-role-policy',
    '--role-name',
    names.role,
    '--policy-name',
    'smoke-storage',
    '--policy-document',
    JSON.stringify(
      smokeHostPolicy(names.logsBucket, names.tracesBucket, secretArn)
    )
  );
  aws(
    REGION,
    'iam',
    'attach-role-policy',
    '--role-name',
    names.role,
    '--policy-arn',
    SSM_POLICY
  );
  aws(
    REGION,
    'iam',
    'create-instance-profile',
    '--instance-profile-name',
    names.role,
    '--path',
    SMOKE_IAM_PATH
  );
  aws(
    REGION,
    'iam',
    'add-role-to-instance-profile',
    '--instance-profile-name',
    names.role,
    '--role-name',
    names.role
  );
  aws(
    REGION,
    'iam',
    'wait',
    'instance-profile-exists',
    '--instance-profile-name',
    names.role
  );
  return {
    instanceProfile: names.role,
    secretArn,
    logsBucket: names.logsBucket,
    tracesBucket: names.tracesBucket,
  };
}

export const SMOKE_HOSTS = {
  grafanaHost: 'grafana-smoke.macro-internal.com',
  otlpHost: 'otlp-smoke.macro-internal.com',
  oncallHost: 'oncall-smoke.macro-internal.com',
};
// No such topic exists, and the smoke role cannot publish anyway: a smoke
// host's alerts must never page anyone.
export const SMOKE_ALARM_TOPIC = `arn:aws:sns:${REGION}:${ACCOUNT}:observability-smoke-unused`;

export function smokeUserData(
  resources: SmokeResources,
  volumeId: string
): string {
  return renderUserData({
    region: REGION,
    ...SMOKE_HOSTS,
    secretArn: resources.secretArn,
    alarmTopicArn: SMOKE_ALARM_TOPIC,
    volumeId,
    logsBucket: resources.logsBucket,
    tracesBucket: resources.tracesBucket,
  });
}

/** Fresh throwaway credentials, so the image's secret validation runs for real. */
export function smokeSecret(): Record<string, string> {
  const random = () => randomBytes(36).toString('base64url');
  return {
    google_client_id: 'observability-smoke.apps.googleusercontent.com',
    google_client_secret: random(),
    grafana_secret_key: random(),
    otlp_token: random(),
    goalert_encryption_key: random(),
    goalert_admin_password: random(),
    // Unroutable: GoAlert's channel relay has nowhere to post.
    macro_alerts_webhook_url: 'https://observability-smoke.invalid/hook',
    macro_alerts_bot_token: random(),
  };
}

// Every unit the image runs, as the README's runtime section lists them.
export const UNITS = [
  'observability-bootstrap',
  'observability-secrets',
  'grafana',
  'loki',
  'tempo',
  'prometheus',
  'alloy',
  'alloy-ingest',
  'nginx',
  'postgresql',
  'goalert',
  'macro-alerts-relay',
];

/** The on-host check, run as root over SSM. Exits non-zero with the failing units' logs. */
export function hostCheckScript(marker: string): string {
  const traceId = marker.padEnd(32, '0').slice(0, 32);
  const otlp = `-H 'Host: ${SMOKE_HOSTS.otlpHost}' -H "Authorization: Bearer $(cat /run/macro-observability/otlp_token)" -H 'Content-Type: application/json'`;
  const log = JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: 'observability-smoke' },
            },
          ],
        },
        scopeLogs: [{ logRecords: [{ body: { stringValue: marker } }] }],
      },
    ],
  });
  const span = JSON.stringify({
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: 'observability-smoke' },
            },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId: traceId.slice(0, 16),
                name: 'smoke',
                kind: 1,
                startTimeUnixNano: 'START',
                endTimeUnixNano: 'END',
              },
            ],
          },
        ],
      },
    ],
  });
  return `set -uo pipefail
units="${UNITS.join(' ')}"
failed() {
  echo "SMOKE FAILED: $1"
  systemctl --no-pager --failed || true
  for unit in $units; do
    systemctl is-active --quiet "$unit" || journalctl --no-pager -u "$unit" -n 40 --since boot
  done
  exit 1
}
ready() {
  for unit in $units; do
    systemctl is-active --quiet "$unit" || { echo "waiting for $unit: $(systemctl is-active "$unit")"; return 1; }
  done
  for url in http://127.0.0.1:8080/healthz http://127.0.0.1:8080/goalert-healthz \\
      http://127.0.0.1:3100/ready http://127.0.0.1:3200/ready http://127.0.0.1:9090/-/ready; do
    curl -fsS -o /dev/null --max-time 5 "$url" || { echo "waiting for $url"; return 1; }
  done
}
deadline=$((SECONDS + 900))
until ready; do
  [ "$SECONDS" -lt "$deadline" ] || failed "services did not become ready"
  sleep 10
done
echo "All units active and health endpoints answer"
uname -r; cat /etc/os-release | grep PRETTY_NAME
findmnt --noheadings --output SOURCE,FSTYPE /srv/observability
now=$(date +%s%N)
span=$(printf '%s' '${span}' | sed "s/START/$now/; s/END/$((now + 1000000))/")
curl -fsS --max-time 10 ${otlp} -d '${log}' http://127.0.0.1:8080/v1/logs > /dev/null || failed "OTLP logs rejected"
curl -fsS --max-time 10 ${otlp} -d "$span" http://127.0.0.1:8080/v1/traces > /dev/null || failed "OTLP traces rejected"
deadline=$((SECONDS + 180))
until curl -fsS -G --max-time 5 http://127.0.0.1:3100/loki/api/v1/query_range \\
    --data-urlencode 'query={service_name="observability-smoke"} |= "${marker}"' | grep -q '${marker}'; do
  [ "$SECONDS" -lt "$deadline" ] || failed "the OTLP log never reached Loki"
  sleep 5
done
echo "OTLP log reached Loki"
until curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:3200/api/traces/${traceId}; do
  [ "$SECONDS" -lt "$deadline" ] || failed "the OTLP span never reached Tempo"
  sleep 5
done
echo "OTLP span reached Tempo"
curl -fsS --max-time 5 'http://127.0.0.1:9090/api/v1/query?query=up' | grep -q '"result":\\[{' || failed "Prometheus has no scraped series"
echo "Prometheus is scraping"
# The ingestion endpoint must refuse a missing token.
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: ${SMOKE_HOSTS.otlpHost}' -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8080/v1/logs)
[ "$code" = 401 ] || failed "ingestion without a token answered $code"
echo "SMOKE PASSED"
`;
}

function smokeTags(runId: string, resourceType: string) {
  return {
    ResourceType: resourceType,
    Tags: [
      { Key: 'project', Value: SMOKE_PROJECT_TAG },
      { Key: 'SmokeRun', Value: runId },
      { Key: 'Name', Value: `observability-smoke-${runId}` },
    ],
  };
}

interface Command {
  Status: string;
  StandardOutputContent: string;
  StandardErrorContent: string;
}

async function runOnHost(instanceId: string, script: string): Promise<boolean> {
  const commandId = aws<{ Command: { CommandId: string } }>(
    REGION,
    'ssm',
    'send-command',
    '--instance-ids',
    instanceId,
    '--document-name',
    'AWS-RunShellScript',
    '--timeout-seconds',
    '60',
    '--parameters',
    JSON.stringify({ commands: [script], executionTimeout: ['1500'] })
  ).Command.CommandId;
  const result = await waitFor('the smoke check', 1800, 15, () => {
    let invocation: Command;
    try {
      invocation = aws<Command>(
        REGION,
        'ssm',
        'get-command-invocation',
        '--command-id',
        commandId,
        '--instance-id',
        instanceId
      );
    } catch {
      return undefined; // Not registered yet.
    }
    return ['Pending', 'InProgress', 'Delayed'].includes(invocation.Status)
      ? undefined
      : invocation;
  });
  console.log(result.StandardOutputContent);
  if (result.StandardErrorContent) console.error(result.StandardErrorContent);
  return result.Status === 'Success';
}

function consoleOutput(instanceId: string): void {
  try {
    const output = aws<{ Output?: string }>(
      REGION,
      'ec2',
      'get-console-output',
      '--instance-id',
      instanceId,
      '--latest'
    ).Output;
    if (output) {
      console.log('--- smoke host console (latest) ---');
      console.log(Buffer.from(output, 'base64').toString('utf8').slice(-20000));
    }
  } catch (error) {
    console.error(`Could not read the console: ${error}`);
  }
}

const failures: string[] = [];

/** Run one removal; a failure is recorded and the sweep continues. */
function attempt(what: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error(`Could not ${what}: ${error}`);
    failures.push(what);
  }
}

/**
 * Remove every smoke resource: this run's and any a cancelled or crashed run
 * left. Rollouts never overlap, so none belongs to a live run. The host is
 * stopped and detached before it is terminated, the calls a production
 * replacement makes, so they are exercised before production depends on them.
 * Throws when something could not be removed, so a leak fails the run.
 */
export function cleanupSmoke(): void {
  const filters = [`Name=tag:project,Values=${SMOKE_PROJECT_TAG}`];
  failures.length = 0;
  const instances = aws<{
    Reservations: {
      Instances: { InstanceId: string; State: { Name: string } }[];
    }[];
  }>(REGION, 'ec2', 'describe-instances', '--filters', ...filters)
    .Reservations.flatMap((reservation) => reservation.Instances)
    .filter((instance) => instance.State.Name !== 'terminated');
  const volumes = aws<{
    Volumes: { VolumeId: string; Attachments: { InstanceId: string }[] }[];
  }>(REGION, 'ec2', 'describe-volumes', '--filters', ...filters).Volumes;
  const ids = instances.map((instance) => instance.InstanceId);
  if (ids.length) {
    attempt('stop smoke hosts', () => {
      aws(REGION, 'ec2', 'stop-instances', '--instance-ids', ...ids);
      aws(REGION, 'ec2', 'wait', 'instance-stopped', '--instance-ids', ...ids);
    });
    for (const volume of volumes.filter((entry) => entry.Attachments.length)) {
      attempt(`detach ${volume.VolumeId}`, () =>
        aws(REGION, 'ec2', 'detach-volume', '--volume-id', volume.VolumeId)
      );
    }
    attempt('terminate smoke hosts', () => {
      aws(REGION, 'ec2', 'terminate-instances', '--instance-ids', ...ids);
      aws(
        REGION,
        'ec2',
        'wait',
        'instance-terminated',
        '--instance-ids',
        ...ids
      );
    });
  }
  for (const volume of volumes) {
    attempt(`delete ${volume.VolumeId}`, () => {
      aws(
        REGION,
        'ec2',
        'wait',
        'volume-available',
        '--volume-ids',
        volume.VolumeId
      );
      aws(REGION, 'ec2', 'delete-volume', '--volume-id', volume.VolumeId);
    });
  }
  const buckets = aws<{ Buckets: { Name: string }[] }>(
    REGION,
    's3api',
    'list-buckets'
  )
    .Buckets.map((bucket) => bucket.Name)
    .filter((name) => name.startsWith(SMOKE_PREFIX));
  for (const bucket of buckets) {
    attempt(`delete bucket ${bucket}`, () =>
      execFileSync(
        'aws',
        ['--region', REGION, 's3', 'rb', `s3://${bucket}`, '--force'],
        {
          stdio: ['ignore', 'ignore', 'inherit'],
        }
      )
    );
  }
  const secrets = aws<{ SecretList: { ARN: string; Name: string }[] }>(
    REGION,
    'secretsmanager',
    'list-secrets',
    '--filters',
    `Key=name,Values=${SMOKE_SECRET_PREFIX}`
  ).SecretList.filter((secret) => secret.Name.startsWith(SMOKE_SECRET_PREFIX));
  for (const secret of secrets) {
    attempt(`delete secret ${secret.Name}`, () =>
      aws(
        REGION,
        'secretsmanager',
        'delete-secret',
        '--secret-id',
        secret.ARN,
        '--force-delete-without-recovery'
      )
    );
  }
  const profiles = aws<{
    InstanceProfiles: {
      InstanceProfileName: string;
      Roles: { RoleName: string }[];
    }[];
  }>(
    REGION,
    'iam',
    'list-instance-profiles',
    '--path-prefix',
    SMOKE_IAM_PATH
  ).InstanceProfiles;
  for (const profile of profiles) {
    attempt(`delete instance profile ${profile.InstanceProfileName}`, () => {
      for (const role of profile.Roles) {
        aws(
          REGION,
          'iam',
          'remove-role-from-instance-profile',
          '--instance-profile-name',
          profile.InstanceProfileName,
          '--role-name',
          role.RoleName
        );
      }
      aws(
        REGION,
        'iam',
        'delete-instance-profile',
        '--instance-profile-name',
        profile.InstanceProfileName
      );
    });
  }
  const roles = aws<{ Roles: { RoleName: string }[] }>(
    REGION,
    'iam',
    'list-roles',
    '--path-prefix',
    SMOKE_IAM_PATH
  ).Roles;
  for (const { RoleName } of roles) {
    attempt(`delete role ${RoleName}`, () => {
      aws(
        REGION,
        'iam',
        'detach-role-policy',
        '--role-name',
        RoleName,
        '--policy-arn',
        SSM_POLICY
      );
      aws(
        REGION,
        'iam',
        'delete-role-policy',
        '--role-name',
        RoleName,
        '--policy-name',
        'smoke-storage'
      );
      aws(REGION, 'iam', 'delete-role', '--role-name', RoleName);
    });
  }
  console.log(
    `Smoke cleanup: instances [${ids.join(', ')}], volumes [${volumes.map((volume) => volume.VolumeId).join(', ')}], ` +
      `buckets [${buckets.join(', ')}], secrets [${secrets.map((secret) => secret.Name).join(', ')}], ` +
      `instance profiles [${profiles.map((profile) => profile.InstanceProfileName).join(', ')}], roles [${roles.map((role) => role.RoleName).join(', ')}]`
  );
  if (failures.length) {
    throw new Error(
      `Could not ${failures.join('; ')}. Delete anything left by hand: tagged project=${SMOKE_PROJECT_TAG}, or named ${SMOKE_PREFIX}* or ${SMOKE_SECRET_PREFIX}*`
    );
  }
}

/** Launch, retrying while a new instance profile propagates through IAM. */
async function launch(args: string[]): Promise<string> {
  for (let tries = 1; ; tries++) {
    try {
      return aws<{ Instances: { InstanceId: string }[] }>(
        REGION,
        'ec2',
        'run-instances',
        ...args
      ).Instances[0].InstanceId;
    } catch (error) {
      if (tries >= 12 || !/instance profile/i.test(String(error))) throw error;
      console.log('Waiting for the new instance profile to reach EC2');
      await sleep(10);
    }
  }
}

/** Boot `target.ami`, run the host check, and always clean up. Returns whether it passed. */
export async function smokeBoot(target: SmokeTarget): Promise<boolean> {
  // Leftovers from a run that died before its own cleanup.
  cleanupSmoke();
  const directory = mkdtempSync(join(tmpdir(), 'observability-smoke-'));
  let instanceId: string | undefined;
  try {
    const resources = await createSmokeResources(target.runId);
    const volumeId = aws<{ VolumeId: string }>(
      REGION,
      'ec2',
      'create-volume',
      '--availability-zone',
      target.availabilityZone,
      '--size',
      '20',
      '--volume-type',
      'gp3',
      '--encrypted',
      '--tag-specifications',
      JSON.stringify([smokeTags(target.runId, 'volume')])
    ).VolumeId;
    const userData = join(directory, 'user-data.gz');
    writeFileSync(
      userData,
      Buffer.from(smokeUserData(resources, volumeId), 'base64')
    );
    instanceId = await launch([
      '--image-id',
      target.ami,
      '--instance-type',
      INSTANCE_TYPE,
      '--subnet-id',
      target.subnetId,
      '--security-group-ids',
      target.securityGroupId,
      '--no-associate-public-ip-address',
      '--iam-instance-profile',
      `Name=${resources.instanceProfile}`,
      '--metadata-options',
      'HttpEndpoint=enabled,HttpTokens=required,HttpPutResponseHopLimit=1',
      '--block-device-mappings',
      JSON.stringify([
        {
          DeviceName: '/dev/xvda',
          Ebs: {
            VolumeType: 'gp3',
            VolumeSize: 30,
            Encrypted: true,
            DeleteOnTermination: true,
          },
        },
      ]),
      '--user-data',
      `fileb://${userData}`,
      '--tag-specifications',
      // The root volume is deleted with the instance, so only the instance is labelled.
      JSON.stringify([smokeTags(target.runId, 'instance')]),
    ]);
    const id = instanceId;
    console.log(`Smoke host ${id} from ${target.ami}`);
    aws(REGION, 'ec2', 'wait', 'instance-running', '--instance-ids', id);
    aws(
      REGION,
      'ec2',
      'attach-volume',
      '--volume-id',
      volumeId,
      '--instance-id',
      id,
      '--device',
      '/dev/sdf'
    );
    const bootStart = Date.now();
    await waitFor('the smoke host to register with SSM', 900, 15, () => {
      const info = aws<{
        InstanceInformationList: { PingStatus: string }[];
      }>(
        REGION,
        'ssm',
        'describe-instance-information',
        '--filters',
        `Key=InstanceIds,Values=${id}`
      ).InstanceInformationList;
      return info[0]?.PingStatus === 'Online' ? true : undefined;
    });
    console.log(
      `SSM online after ${Math.round((Date.now() - bootStart) / 1000)}s`
    );
    const passed = await runOnHost(
      id,
      hostCheckScript(randomBytes(16).toString('hex'))
    );
    console.log(
      `Smoke check ${passed ? 'passed' : 'FAILED'} ${Math.round((Date.now() - bootStart) / 1000)}s after boot`
    );
    if (!passed) consoleOutput(id);
    return passed;
  } catch (error) {
    if (instanceId) consoleOutput(instanceId);
    throw error;
  } finally {
    rmSync(directory, { recursive: true, force: true });
    cleanupSmoke();
  }
}

// The observability deploy pipeline, one subcommand per workflow step:
//
//   latest   refuse a commit older than main's newest change to this stack
//   find     look for a smoke-tested AMI built from this source
//   publish  publish the built image as an AMI
//   smoke    boot the AMI on a throwaway host and check it; tag it if it passes
//   deploy   check the plan and permissions, then (unless DRY_RUN=true)
//            `pulumi up` and wait for health. Replacing the host takes
//            Grafana, Loki, Tempo and GoAlert down for several minutes.
//   cleanup  remove this run's smoke host, if a cancelled run left one
//
// Run from infra/stacks/observability with deploy-role credentials, e.g.
// `bun deploy/release.ts find`. See the README's "Deploying".
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { REGION, type Tag, aws, tagValue, waitFor } from './aws';
import { replacementChecks, simulate, stackResources } from './iam-preflight';
import { SOURCE_TAG_PREFIX, imageSourceKey } from './image-key';
import { checkPlan } from './plan';
import { publishImage } from './publish';
import { cleanupSmoke, smokeBoot } from './smoke';

export const STACK = 'macro-inc/observability/prod';
export const DEPLOY_STACK = 'macro-inc/observability-deploy/prod';
export const IMAGE_BUCKET = 'macro-observability-images-569036502058-us-east-2';
export const IMPORT_ROLE = 'macro-observability-vmimport';
export const STACK_PATHS = ['infra/stacks/observability'];
const GRAFANA_HEALTH = 'https://grafana.macro-internal.com/api/health';

const stackDir = process.cwd();

function output(name: string, value: string): void {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function pulumi(args: string[]): string {
  return execFileSync('pulumi', ['--non-interactive', ...args], {
    cwd: stackDir,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

interface Image {
  ImageId: string;
  State: string;
  CreationDate: string;
  Tags?: Tag[];
}

function images(...filters: string[]): Image[] {
  return aws<{ Images: Image[] }>(
    REGION,
    'ec2',
    'describe-images',
    '--owners',
    'self',
    '--filters',
    'Name=tag:project,Values=observability',
    ...filters
  )
    .Images.filter((image) => image.State === 'available')
    .sort((a, b) => b.CreationDate.localeCompare(a.CreationDate));
}

/** The NixOS system the image boots, which identifies its content exactly. */
function nixSystem(): string {
  return basename(
    execFileSync(
      'nix',
      [
        'eval',
        '--raw',
        '.#nixosConfigurations.observability.config.system.build.toplevel.outPath',
      ],
      { cwd: stackDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    ).trim()
  );
}

function tag(ami: string, ...tags: string[]): void {
  aws(REGION, 'ec2', 'create-tags', '--resources', ami, '--tags', ...tags);
}

/** Fail when main has a newer change to this stack than `GITHUB_SHA`. */
async function latest(): Promise<void> {
  const repository = env('GITHUB_REPOSITORY');
  const sha = env('GITHUB_SHA');
  const lastChange = async (ref: string) => {
    const query = new URLSearchParams({ sha: ref, per_page: '1' });
    for (const path of STACK_PATHS) query.append('path', path);
    const response = await fetch(
      `https://api.github.com/repos/${repository}/commits?${query}`,
      {
        headers: {
          authorization: `Bearer ${env('GITHUB_TOKEN')}`,
          accept: 'application/vnd.github+json',
        },
      }
    );
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const [commit] = (await response.json()) as { sha: string }[];
    return commit?.sha;
  };
  const [mine, mains] = [await lastChange(sha), await lastChange('main')];
  // Re-running an old run must never roll production back.
  if (mine !== mains) {
    throw new Error(
      `main's newest change to the stack is ${mains}, not this commit's ${mine}. Start a new run from main instead of re-running this one.`
    );
  }
  console.log(`${sha} has main's newest change to the stack`);
}

function find(): void {
  const key = imageSourceKey(stackDir);
  output('key', key);
  const tested = images(`Name=tag-key,Values=${SOURCE_TAG_PREFIX}${key}`);
  if (tested.length) {
    output('ami', tested[0].ImageId);
    output('stage', 'deploy');
    return;
  }
  const system = nixSystem();
  output('system', system);
  // An unchanged system (a comment, a test) reuses its AMI and keeps the host.
  const built = images(`Name=tag:NixSystem,Values=${system}`);
  const passed = built.find(
    (image) => tagValue(image.Tags, 'Smoke') === 'passed'
  );
  if (passed) {
    tag(passed.ImageId, `Key=${SOURCE_TAG_PREFIX}${key},Value=true`);
    output('ami', passed.ImageId);
    output('stage', 'deploy');
  } else if (built.length) {
    output('ami', built[0].ImageId);
    output('stage', 'smoke');
  } else {
    output('stage', 'build');
  }
}

async function publish(): Promise<void> {
  const published = await publishImage({
    imageDirectory: 'result',
    bucket: IMAGE_BUCKET,
    role: IMPORT_ROLE,
    region: REGION,
    namePrefix: 'macro-observability',
    tags: [
      { Key: 'NixSystem', Value: env('NIX_SYSTEM') },
      { Key: 'GitCommit', Value: env('GITHUB_SHA') },
    ],
  });
  output('ami', published.ami);
}

function stackExport() {
  return stackResources(
    JSON.parse(pulumi(['stack', 'export', '--stack', STACK]))
  );
}

function deployOutputs(): Record<string, string> {
  return JSON.parse(
    pulumi(['stack', 'output', '--stack', DEPLOY_STACK, '--json'])
  );
}

function runId(): string {
  return `${env('GITHUB_RUN_ID')}-${env('GITHUB_RUN_ATTEMPT')}`;
}

async function smoke(): Promise<void> {
  const ami = env('AMI');
  const stack = stackExport();
  const outputs = deployOutputs();
  const passed = await smokeBoot({
    ami,
    subnetId: stack.subnetId,
    securityGroupId: stack.securityGroupIds[0],
    availabilityZone: stack.availabilityZone,
    instanceProfile: outputs.smokeInstanceProfile,
    secretArn: outputs.smokeSecretArn,
    logsBucket: outputs.smokeLogsBucket,
    tracesBucket: outputs.smokeTracesBucket,
    runId: runId(),
  });
  tag(ami, `Key=Smoke,Value=${passed ? 'passed' : 'failed'}`);
  if (!passed) {
    throw new Error(`${ami} failed its smoke boot; production was not touched`);
  }
  tag(ami, `Key=${SOURCE_TAG_PREFIX}${imageSourceKey(stackDir)},Value=true`);
}

interface TargetHealth {
  TargetHealthDescriptions: {
    Target: { Id: string };
    TargetHealth: { State: string };
  }[];
}

async function waitHealthy(started: number): Promise<void> {
  const stack = stackExport();
  for (const group of stack.targetGroupArns) {
    await waitFor(
      `${stack.instanceId} to pass ${group}'s health check`,
      1500,
      15,
      () => {
        const health = aws<TargetHealth>(
          REGION,
          'elbv2',
          'describe-target-health',
          '--target-group-arn',
          group
        ).TargetHealthDescriptions;
        const state = health.find(
          (entry) => entry.Target.Id === stack.instanceId
        )?.TargetHealth.State;
        return state === 'healthy' ? true : undefined;
      }
    );
  }
  await waitFor(
    'Grafana to answer through the load balancer',
    300,
    10,
    async () => {
      const response = await fetch(GRAFANA_HEALTH).catch(() => undefined);
      return response?.ok ? true : undefined;
    }
  );
  console.log(
    `${stack.instanceId} is healthy ${Math.round((Date.now() - started) / 1000)}s after the update started`
  );
}

async function deploy(): Promise<void> {
  const ami = env('AMI');
  // `--show-sames` lists unchanged resources too, so the check can see the
  // retained storage is left alone; without it the JSON omits them.
  const preview = JSON.parse(
    pulumi(['preview', '--stack', STACK, '--json', '--show-sames'])
  );
  const plan = checkPlan(preview);
  console.log(`Planned changes:\n${plan.changes.join('\n') || '(none)'}`);
  if (plan.refused.length) {
    throw new Error(
      `This change needs a reviewed manual \`pulumi up\` (see README):\n${plan.refused.join('\n')}`
    );
  }
  if (!plan.changes.length) {
    console.log(`Production already runs ${ami}; nothing to deploy`);
    return;
  }
  const denied = simulate(replacementChecks(stackExport(), ami));
  if (denied.length) {
    throw new Error(
      `The deploy role cannot complete a replacement; production was not touched:\n${denied.join('\n')}`
    );
  }
  if (!plan.instanceUrn) throw new Error('The plan has no instance URN');
  if (process.env.DRY_RUN === 'true') {
    console.log(
      `Dry run: stopping before \`pulumi up\`. Production still runs its current image; a real run would replace the host with ${ami}.`
    );
    return;
  }
  const started = Date.now();
  // Restricted to the instance and what references it, whatever else changed
  // since the preview.
  execFileSync(
    'pulumi',
    [
      '--non-interactive',
      'up',
      '--stack',
      STACK,
      '--yes',
      '--diff',
      '--target',
      plan.instanceUrn,
      '--target-dependents',
    ],
    { cwd: stackDir, stdio: 'inherit' }
  );
  await waitHealthy(started);
}

const commands: Record<string, () => void | Promise<void>> = {
  latest,
  find,
  publish,
  smoke,
  deploy,
  cleanup: () => cleanupSmoke(runId()),
};

if (import.meta.main) {
  const command = commands[process.argv[2] ?? ''];
  if (!command) {
    throw new Error(
      `Usage: bun deploy/release.ts <${Object.keys(commands).join('|')}>`
    );
  }
  await command();
}

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Only build outputs with a Vite content hash are eligible, including maps.
const HASHED_ASSET =
  /-(?=[A-Za-z0-9_-]*[A-Z0-9_])[A-Za-z0-9_-]{8}\.(?:js|css|wasm|woff2?|ttf|svg|png|jpe?g|webp|glb)(?:\.map)?$/;

const [distArgument, destination, retentionArgument = '7'] =
  process.argv.slice(2);
if (
  !distArgument ||
  !destination?.startsWith('s3://') ||
  !/^[1-9][0-9]*$/.test(retentionArgument)
) {
  throw new Error(
    'usage: prune-retired-assets.ts <dist-root> <s3-prefix> [retention-days]'
  );
}
const dist = resolve(distArgument);
const location = new URL(destination);
const bucket = location.hostname;
const prefix = `${location.pathname.replace(/^\/+|\/+$/g, '')}/`;
if (!bucket || prefix === '/')
  throw new Error('An S3 bucket and prefix are required');
const manifestKey = `${prefix}.retired-assets.json`;
const now = Date.now();
const cutoff = now - Number(retentionArgument) * 24 * 60 * 60 * 1000;

function aws(args: string[], input?: string): string {
  return execFileSync('aws', args, {
    encoding: 'utf8',
    input,
    // A week of chunks and retirement timestamps can exceed Node's default
    // buffer by orders of magnitude on our frequently deployed dev build.
    maxBuffer: 256 * 1024 * 1024,
  });
}

function localKeys(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? localKeys(path)
      : [prefix + relative(dist, path).split('\\').join('/')];
  });
}

const current = new Set(localKeys(dist));
if (!current.has(`${prefix}index.html`)) {
  throw new Error('Refusing to prune without the published build');
}
const listed: unknown = JSON.parse(
  aws([
    's3api',
    'list-objects-v2',
    '--bucket',
    bucket,
    '--prefix',
    prefix,
    '--query',
    'Contents[].Key',
    '--output',
    'json',
  ])
);
if (
  !Array.isArray(listed) ||
  !listed.every((key) => typeof key === 'string' && key.startsWith(prefix))
) {
  throw new Error('Invalid S3 object listing');
}
const keys: string[] = listed;
const previous: Record<string, number> = {};
if (keys.includes(manifestKey)) {
  const value: unknown = JSON.parse(
    aws(['s3', 'cp', `s3://${bucket}/${manifestKey}`, '-'])
  );
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid retired asset manifest');
  }
  for (const [key, retiredAt] of Object.entries(value)) {
    if (
      typeof retiredAt !== 'number' ||
      !Number.isFinite(retiredAt) ||
      retiredAt <= 0
    ) {
      throw new Error('Invalid asset retirement timestamp');
    }
    previous[key] = retiredAt;
  }
}

const retired: Record<string, number> = {};
for (const key of keys) {
  if (HASHED_ASSET.test(key) && !current.has(key)) {
    // Measure from when a file stopped being published, not S3 LastModified:
    // an unchanged chunk can be months old and still used by yesterday's build.
    retired[key] = previous[key] ?? now;
  }
}
// Persist the grace period before deleting anything. The manifest is private;
// only the deployment role needs it. Failures in listing/reading/writing abort.
aws(
  [
    's3',
    'cp',
    '-',
    `s3://${bucket}/${manifestKey}`,
    '--content-type',
    'application/json',
  ],
  JSON.stringify(retired)
);
const expired = Object.entries(retired)
  .filter(([, retiredAt]) => retiredAt <= cutoff)
  .map(([Key]) => ({ Key }));
// Dev can retire thousands of chunks per deployment. Batch the deletes and
// pass the payload on stdin so key lengths cannot exceed OS argument limits.
for (let offset = 0; offset < expired.length; offset += 1000) {
  const result: { Errors?: unknown[] } = JSON.parse(
    aws(
      [
        's3api',
        'delete-objects',
        '--bucket',
        bucket,
        '--delete',
        'file:///dev/stdin',
        '--output',
        'json',
      ],
      JSON.stringify({
        Objects: expired.slice(offset, offset + 1000),
        Quiet: true,
      })
    ) || '{}'
  );
  // S3 reports per-object failures inside a successful HTTP response.
  if (result.Errors?.length) {
    throw new Error(
      `Failed to delete retired assets: ${JSON.stringify(result.Errors)}`
    );
  }
}

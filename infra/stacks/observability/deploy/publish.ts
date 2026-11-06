// Publish a built NixOS image as a private AMI. An explicit AWS write: it
// uploads the VHD, imports an encrypted snapshot and registers the AMI. It
// never launches or modifies an instance.
//
//   bun deploy/publish.ts <image-dir> <bucket> [--role R] [--region R] [--name-prefix P]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Tag, aws, requireAccount, waitFor } from './aws';

export const NAME_PREFIXES = [
  'macro-observability',
  'macro-database-collector',
] as const;
export const REGIONS = ['us-east-1', 'us-east-2'] as const;

export interface PublishOptions {
  imageDirectory: string;
  bucket: string;
  role: string;
  region: (typeof REGIONS)[number];
  namePrefix: (typeof NAME_PREFIXES)[number];
  /** Extra AMI tags, such as the NixOS system it boots. */
  tags?: Tag[];
}

export interface Published {
  ami: string;
  snapshot: string;
  digest: string;
}

interface ImageInfo {
  system: string;
  boot_mode: string;
  file: string;
}

/** The VHD a `nix build` of this flake produced, validated like the Python original. */
export function imageFile(imageDirectory: string): string {
  const info = JSON.parse(
    readFileSync(join(imageDirectory, 'nix-support/image-info.json'), 'utf8')
  ) as ImageInfo;
  if (info.system !== 'x86_64-linux' || info.boot_mode !== 'uefi') {
    throw new Error('Expected an x86_64 UEFI image from this flake');
  }
  const image = join(imageDirectory, basename(info.file));
  if (!image.endsWith('.vhd')) throw new Error('Expected the VHD image format');
  return image;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function checkBucket(region: string, bucket: string): void {
  const location =
    aws<{ LocationConstraint: string | null }>(
      region,
      's3api',
      'get-bucket-location',
      '--bucket',
      bucket
    ).LocationConstraint ?? 'us-east-1';
  if (location !== region) {
    throw new Error('Image bucket must be in the target region');
  }
  const block = aws<{
    PublicAccessBlockConfiguration: Record<string, boolean>;
  }>(
    region,
    's3api',
    'get-public-access-block',
    '--bucket',
    bucket
  ).PublicAccessBlockConfiguration;
  for (const key of [
    'BlockPublicAcls',
    'IgnorePublicAcls',
    'BlockPublicPolicy',
    'RestrictPublicBuckets',
  ]) {
    if (!block[key]) {
      throw new Error('Image bucket must have all S3 public-access blocks');
    }
  }
}

interface ImportTask {
  ImportTaskId: string;
  Description?: string;
  SnapshotTaskDetail: { Status: string; SnapshotId?: string };
}

function importTasks(region: string): ImportTask[] {
  return aws<{ ImportSnapshotTasks: ImportTask[] }>(
    region,
    'ec2',
    'describe-import-snapshot-tasks'
  ).ImportSnapshotTasks;
}

/** An AMI already registered for this exact image, from an earlier run. */
function existingAmi(region: string, digest: string): string | undefined {
  const images = aws<{ Images: { ImageId: string; State: string }[] }>(
    region,
    'ec2',
    'describe-images',
    '--owners',
    'self',
    '--filters',
    `Name=tag:ImageSHA256,Values=${digest}`
  ).Images.filter((image) => image.State !== 'failed');
  return images[0]?.ImageId;
}

export async function publishImage(
  options: PublishOptions
): Promise<Published> {
  const { region, bucket, namePrefix } = options;
  requireAccount(region);
  checkBucket(region, bucket);
  const image = imageFile(options.imageDirectory);
  const digest = await sha256(image);
  const extraTags = (options.tags ?? []).map(
    (tag) => `Key=${tag.Key},Value=${tag.Value}`
  );
  const reused = existingAmi(region, digest);
  if (reused) {
    console.log(`AMI ${reused} already holds image ${digest}; reusing it`);
    if (extraTags.length) {
      aws(
        region,
        'ec2',
        'create-tags',
        '--resources',
        reused,
        '--tags',
        ...extraTags
      );
    }
    const snapshot = aws<{
      Images: { BlockDeviceMappings: { Ebs?: { SnapshotId: string } }[] }[];
    }>(region, 'ec2', 'describe-images', '--image-ids', reused).Images[0]
      .BlockDeviceMappings[0].Ebs?.SnapshotId;
    return { ami: reused, snapshot: snapshot ?? '', digest };
  }

  const description = `${namePrefix} ${digest}`;
  const key = `${namePrefix}/${digest}.vhd`;
  // Resume an interrupted publication instead of importing the image twice.
  let task = importTasks(region).find(
    (entry) =>
      entry.Description === description &&
      ['active', 'pending', 'completed'].includes(
        entry.SnapshotTaskDetail.Status
      )
  )?.ImportTaskId;
  if (task) {
    console.log(`Resuming import task ${task}`);
  } else {
    execFileSync(
      'aws',
      [
        '--region',
        region,
        's3',
        'cp',
        '--only-show-errors',
        image,
        `s3://${bucket}/${key}`,
        '--sse',
        'AES256',
      ],
      { stdio: 'inherit' }
    );
    task = aws<{ ImportTaskId: string }>(
      region,
      'ec2',
      'import-snapshot',
      '--role-name',
      options.role,
      '--encrypted',
      '--description',
      description,
      '--disk-container',
      JSON.stringify({
        Format: 'VHD',
        UserBucket: { S3Bucket: bucket, S3Key: key },
      })
    ).ImportTaskId;
    console.log(`Import task: ${task}; artifact: s3://${bucket}/${key}`);
  }
  const importId = task;
  const snapshot = await waitFor(
    `import task ${importId} (inspect it before retrying)`,
    3600,
    20,
    () => {
      const detail = aws<{ ImportSnapshotTasks: ImportTask[] }>(
        region,
        'ec2',
        'describe-import-snapshot-tasks',
        '--import-task-ids',
        importId
      ).ImportSnapshotTasks[0].SnapshotTaskDetail;
      if (detail.Status === 'completed') return detail.SnapshotId;
      if (!['active', 'pending'].includes(detail.Status)) {
        throw new Error(`Import failed: ${JSON.stringify(detail)}`);
      }
      return undefined;
    }
  );
  if (!snapshot) throw new Error(`Import task ${importId} has no snapshot`);
  console.log(`Imported snapshot: ${snapshot}`);
  const ami = aws<{ ImageId: string }>(
    region,
    'ec2',
    'register-image',
    '--name',
    `${namePrefix}-${digest.slice(0, 20)}`,
    '--architecture',
    'x86_64',
    '--virtualization-type',
    'hvm',
    '--boot-mode',
    'uefi',
    '--ena-support',
    '--imds-support',
    'v2.0',
    '--root-device-name',
    '/dev/xvda',
    '--block-device-mappings',
    JSON.stringify([
      {
        DeviceName: '/dev/xvda',
        Ebs: {
          SnapshotId: snapshot,
          VolumeType: 'gp3',
          DeleteOnTermination: true,
        },
      },
    ])
  ).ImageId;
  console.log(`AMI: ${ami}; SHA256: ${digest}`);
  aws(
    region,
    'ec2',
    'create-tags',
    '--resources',
    ami,
    snapshot,
    '--tags',
    'Key=project,Value=observability',
    `Key=ImageSHA256,Value=${digest}`,
    ...extraTags
  );
  execFileSync(
    'aws',
    ['--region', region, 'ec2', 'wait', 'image-available', '--image-ids', ami],
    { stdio: 'inherit' }
  );
  return { ami, snapshot, digest };
}

function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  name: string
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      role: { type: 'string', default: 'vmimport' },
      region: { type: 'string', default: 'us-east-2' },
      'name-prefix': { type: 'string', default: 'macro-observability' },
    },
  });
  const [imageDirectory, bucket] = positionals;
  if (!imageDirectory || !bucket || positionals.length !== 2) {
    throw new Error(
      'Usage: bun deploy/publish.ts <image-dir> <bucket> [--role R] [--region R] [--name-prefix P]'
    );
  }
  const published = await publishImage({
    imageDirectory,
    bucket,
    role: values.role,
    region: oneOf(values.region, REGIONS, '--region'),
    namePrefix: oneOf(values['name-prefix'], NAME_PREFIXES, '--name-prefix'),
  });
  console.log(
    `Published ${published.ami}. No instance was launched. The observability ` +
      'host deploys it through the deploy workflow; see README.'
  );
}

if (import.meta.main) await main();

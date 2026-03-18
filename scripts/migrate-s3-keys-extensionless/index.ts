import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

const S3_BUCKET = process.env.S3_BUCKET;
const DRY_RUN = process.env.DRY_RUN === "true";
const PREFIX = process.env.PREFIX ?? "macro|";
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "20", 10);
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE ?? "100", 10);

if (!S3_BUCKET) {
  console.error("S3_BUCKET is required");
  process.exit(1);
}

const s3 = new S3Client({});

const EXTENSION_REGEX = /\/[^/]+\.[^./]+$/;
const SKIP_PATTERNS = [/converted\.pdf$/, /^temp_files\//, /^ONBOARDING_DOCUMENTS\//];

interface Stats {
  scanned: number;
  copied: number;
  skipped: number;
  missing: number;
  errors: number;
}

const stats: Stats = { scanned: 0, copied: 0, skipped: 0, missing: 0, errors: 0 };

function stripExtension(key: string): string {
  return key.replace(/\.[^./]+$/, "");
}

function shouldProcess(key: string): boolean {
  if (!EXTENSION_REGEX.test(key)) return false;
  return !SKIP_PATTERNS.some((p) => p.test(key));
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function copyKey(oldKey: string, newKey: string): Promise<void> {
  if (DRY_RUN) {
    console.log(`  [dry run] ${oldKey} -> ${newKey}`);
    stats.copied++;
    return;
  }

  if (await exists(newKey)) {
    stats.skipped++;
    return;
  }

  if (!(await exists(oldKey))) {
    console.warn(`  WARNING: source missing: ${oldKey}`);
    stats.missing++;
    return;
  }

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${oldKey}`,
        Key: newKey,
      })
    );
    console.log(`  Copied: ${oldKey} -> ${newKey}`);
    stats.copied++;
  } catch (err) {
    console.error(`  ERROR copying ${oldKey}:`, err);
    stats.errors++;
  }
}

async function processBatch(keys: string[]): Promise<void> {
  const tasks = keys.map((key) => copyKey(key, stripExtension(key)));
  await Promise.all(tasks);
}

async function main() {
  console.log("=== Migrating S3 keys to extensionless convention ===");
  console.log(`  Bucket: ${S3_BUCKET}`);
  console.log(`  Prefix: ${PREFIX || "<all>"}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  if (DRY_RUN) console.log("  === DRY RUN MODE ===");
  console.log();

  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: PREFIX || undefined,
        MaxKeys: PAGE_SIZE,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (response.Contents ?? [])
      .map((obj) => obj.Key!)
      .filter(Boolean);

    stats.scanned += keys.length;

    const toMigrate = keys.filter(shouldProcess);

    // Process in concurrent batches
    for (let i = 0; i < toMigrate.length; i += CONCURRENCY) {
      const batch = toMigrate.slice(i, i + CONCURRENCY);
      await processBatch(batch);
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;

    if (continuationToken) {
      console.log(
        `  ... scanned=${stats.scanned} copied=${stats.copied} skipped=${stats.skipped}`
      );
    }
  } while (continuationToken);

  console.log();
  console.log("=== Migration complete ===");
  console.log(`  Scanned: ${stats.scanned}`);
  console.log(`  Copied:  ${stats.copied}`);
  console.log(`  Skipped: ${stats.skipped} (extensionless key already exists)`);
  console.log(`  Missing: ${stats.missing} (source key not found)`);
  console.log(`  Errors:  ${stats.errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

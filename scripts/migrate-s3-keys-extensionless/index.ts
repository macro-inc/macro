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
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const USER = process.env.USER_PREFIX;
const DOCUMENT_ID = process.env.DOCUMENT_ID;

if (!S3_BUCKET) {
  console.error("S3_BUCKET is required");
  process.exit(1);
}

const s3 = new S3Client({});

// Matches keys in the format: {owner}/{uuid_v4}/{version_id}.{extension}
// e.g. macro|user@foo.com/12f9a0ac-d445-45e3-94c1-5e8c02f0a6d8/564457.pdf
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const VERSION_WITH_EXT_REGEX = new RegExp(
  `${UUID_V4}/(\\d+)\\..+$`
);
const SKIP_PATTERNS = [/converted\.pdf$/, /^temp_files\//, /^ONBOARDING_DOCUMENTS\//];

interface Stats {
  scanned: number;
  copied: number;
  skipped: number;
  missing: number;
  errors: number;
}

const stats: Stats = { scanned: 0, copied: 0, skipped: 0, missing: 0, errors: 0 };

function buildPrefix(): string | undefined {
  if (USER && DOCUMENT_ID) return `${USER}/${DOCUMENT_ID}/`;
  if (USER) return `${USER}/`;
  return PREFIX || undefined;
}

function stripExtension(key: string): string {
  // Strip everything after the version_id (handles multipart extensions like .js.map)
  return key.replace(/(\d+)\..+$/, "$1");
}

function shouldProcess(key: string): boolean {
  if (!VERSION_WITH_EXT_REGEX.test(key)) return false;
  return !SKIP_PATTERNS.some((p) => p.test(key));
}

async function exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      return false;
    }
    throw err;
  }
}

async function copyKey(oldKey: string, newKey: string): Promise<void> {
  if (await exists(newKey)) {
    if (DRY_RUN) console.log(`  [dry run] SKIP (exists): ${newKey}`);
    stats.skipped++;
    return;
  }

  if (!(await exists(oldKey))) {
    console.warn(`  WARNING: source missing: ${oldKey}`);
    stats.missing++;
    return;
  }

  if (DRY_RUN) {
    console.log(`  [dry run] ${oldKey} -> ${newKey}`);
    stats.copied++;
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
  if (USER) console.log(`  User: ${USER}`);
  if (DOCUMENT_ID) console.log(`  Document: ${DOCUMENT_ID}`);
  if (DRY_RUN) console.log(`  === DRY RUN MODE ===${LIMIT ? ` (limit: ${LIMIT})` : ""}`);

  console.log();

  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: buildPrefix(),
        MaxKeys: PAGE_SIZE,
        ContinuationToken: continuationToken,
      })
    );

    const keys = (response.Contents ?? [])
      .filter((obj) => obj.Key)
      .map((obj) => obj.Key!);

    stats.scanned += keys.length;

    let toMigrate = keys.filter(shouldProcess);

    if (LIMIT !== undefined) {
      const remaining = LIMIT - stats.copied - stats.skipped - stats.missing;
      if (remaining <= 0) break;
      toMigrate = toMigrate.slice(0, remaining);
    }

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

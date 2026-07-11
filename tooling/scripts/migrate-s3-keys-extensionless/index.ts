import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  appendFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { createInterface } from 'readline';

const S3_BUCKET = process.env.S3_BUCKET;
const DRY_RUN = process.env.DRY_RUN === 'true';
const PREFIX = process.env.PREFIX ?? 'macro|';
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '20', 10);
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE ?? '100', 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const USER = process.env.USER_PREFIX;
const DOCUMENT_ID = process.env.DOCUMENT_ID;
const KEYS_FILE = process.env.KEYS_FILE;
const RESET = process.env.RESET === 'true';

if (!S3_BUCKET) {
  console.error('S3_BUCKET is required');
  process.exit(1);
}

const s3 = new S3Client({});

const CURSOR_FILE = `cursor-${S3_BUCKET}.txt`;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = `migration-${S3_BUCKET}-${timestamp}.log`;
const COPIED_KEYS_FILE = `copied-keys-${S3_BUCKET}-${timestamp}.txt`;

function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function loadCursor(): string | undefined {
  if (RESET) {
    clearCursor();
    return undefined;
  }
  if (USER || DOCUMENT_ID) return undefined;
  if (!existsSync(CURSOR_FILE)) return undefined;
  const cursor = readFileSync(CURSOR_FILE, 'utf-8').trim();
  if (!cursor) return undefined;
  log(`Resuming from cursor: ${cursor}`);
  return cursor;
}

function saveCursor(lastKey: string) {
  if (DRY_RUN || USER || DOCUMENT_ID) return;
  writeFileSync(CURSOR_FILE, lastKey + '\n');
}

function clearCursor() {
  if (existsSync(CURSOR_FILE)) {
    writeFileSync(CURSOR_FILE, '');
  }
}

// Matches keys in the format: {owner}/{uuid_v4}/{version_id}.{extension}
// e.g. macro|user@foo.com/12f9a0ac-d445-45e3-94c1-5e8c02f0a6d8/564457.pdf
const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VERSION_WITH_EXT_REGEX = new RegExp(`${UUID_V4}/(\\d+)\\..+$`);
const SKIP_PATTERNS = [
  /converted\.pdf$/,
  /^temp_files\//,
  /^ONBOARDING_DOCUMENTS\//,
];

interface Stats {
  scanned: number;
  copied: number;
  skipped: number;
  missing: number;
  errors: number;
}

const stats: Stats = {
  scanned: 0,
  copied: 0,
  skipped: 0,
  missing: 0,
  errors: 0,
};

function buildPrefix(): string | undefined {
  if (USER && DOCUMENT_ID) return `${USER}/${DOCUMENT_ID}/`;
  if (USER) return `${USER}/`;
  return PREFIX || undefined;
}

function stripExtension(key: string): string {
  // Strip everything after the version_id (handles multipart extensions like .js.map)
  return key.replace(/(\d+)\..+$/, '$1');
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
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
      return false;
    }
    throw err;
  }
}

async function copyKey(oldKey: string, newKey: string): Promise<void> {
  if (await exists(newKey)) {
    if (DRY_RUN && (USER || DOCUMENT_ID))
      log(`[dry run] SKIP (exists): ${newKey}`);
    stats.skipped++;
    return;
  }

  if (DRY_RUN) {
    if (USER || DOCUMENT_ID) log(`[dry run] ${oldKey} -> ${newKey}`);
    stats.copied++;
    return;
  }

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${oldKey.split('/').map(encodeURIComponent).join('/')}`,
        Key: newKey,
      })
    );
    appendFileSync(COPIED_KEYS_FILE, oldKey + '\n');
    stats.copied++;
  } catch (err) {
    log(`ERROR copying ${oldKey}: ${err}`);
    stats.errors++;
  }
}

async function processBatch(keys: string[]): Promise<void> {
  const tasks = keys.map((key) => copyKey(key, stripExtension(key)));
  await Promise.all(tasks);
}

async function migrateFromFile(filePath: string) {
  log(`Reading keys from: ${filePath}`);

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let batch: string[] = [];
  for await (const line of rl) {
    const key = line.trim();
    if (!key) continue;
    stats.scanned++;
    batch.push(key);

    if (batch.length >= CONCURRENCY) {
      if (LIMIT !== undefined && stats.copied + stats.skipped >= LIMIT) break;
      await processBatch(batch);
      batch = [];

      if (stats.scanned % 1000 === 0) {
        log(
          `... scanned=${stats.scanned} copied=${stats.copied} skipped=${stats.skipped}`
        );
      }
    }
  }

  if (batch.length > 0) await processBatch(batch);
}

async function migrateFromScan() {
  const startAfter = loadCursor();

  let continuationToken: string | undefined;

  do {
    let response;
    try {
      response = await s3.send(
        new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: buildPrefix(),
          MaxKeys: PAGE_SIZE,
          EncodingType: 'url',
          ContinuationToken: continuationToken,
          ...(startAfter && !continuationToken
            ? { StartAfter: startAfter }
            : {}),
        })
      );
    } catch (err) {
      log(`ERROR listing objects: ${err}`);
      throw err;
    }

    const keys = (response.Contents ?? [])
      .filter((obj) => obj.Key)
      .map((obj) => decodeURIComponent(obj.Key!));

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

    // Save cursor to last scanned key for resumability
    const lastKey = keys[keys.length - 1];
    if (lastKey) saveCursor(lastKey);

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;

    if (continuationToken) {
      log(
        `... scanned=${stats.scanned} copied=${stats.copied} skipped=${stats.skipped}`
      );
    }
  } while (continuationToken);

  // Clear cursor on successful completion
  if (!DRY_RUN && !USER && !DOCUMENT_ID) clearCursor();
}

async function main() {
  log('=== Migrating S3 keys to extensionless convention ===');
  log(`Bucket: ${S3_BUCKET}`);
  if (KEYS_FILE) log(`Keys file: ${KEYS_FILE}`);
  if (!KEYS_FILE) log(`Prefix: ${PREFIX || '<all>'}`);
  log(`Concurrency: ${CONCURRENCY}`);
  if (USER) log(`User: ${USER}`);
  if (DOCUMENT_ID) log(`Document: ${DOCUMENT_ID}`);
  if (DRY_RUN) log(`=== DRY RUN MODE ===${LIMIT ? ` (limit: ${LIMIT})` : ''}`);
  log(`Log file: ${LOG_FILE}`);
  if (!DRY_RUN) log(`Copied keys file: ${COPIED_KEYS_FILE}`);

  if (KEYS_FILE) {
    await migrateFromFile(KEYS_FILE);
  } else {
    await migrateFromScan();
  }

  log('=== Migration complete ===');
  log(`Scanned: ${stats.scanned}`);
  log(`Copied:  ${stats.copied}`);
  log(`Skipped: ${stats.skipped} (extensionless key already exists)`);
  log(`Missing: ${stats.missing} (source key not found)`);
  log(`Errors:  ${stats.errors}`);
}

process.on('unhandledRejection', (err) => {
  log(`Unhandled rejection: ${err}`);
  process.exit(1);
});

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});

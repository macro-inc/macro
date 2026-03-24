import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  appendFileSync,
  writeFileSync,
  readFileSync,
  createReadStream,
  existsSync,
} from "fs";
import { createInterface } from "readline";

const S3_BUCKET = process.env.S3_BUCKET;
const DRY_RUN = process.env.DRY_RUN === "true";
const PREFIX = process.env.PREFIX ?? "macro|";
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "20", 10);
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE ?? "1000", 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const USER = process.env.USER_PREFIX;
const DOCUMENT_ID = process.env.DOCUMENT_ID;
const KEYS_FILE = process.env.KEYS_FILE;
const CURSOR_FILE = `delete-cursor-${S3_BUCKET}.txt`;

if (!S3_BUCKET) {
  console.error("S3_BUCKET is required");
  process.exit(1);
}

const s3 = new S3Client({});

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const LOG_FILE = `delete-${S3_BUCKET}-${timestamp}.log`;

function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + "\n");
}

function buildPrefix(): string | undefined {
  if (USER && DOCUMENT_ID) return `${USER}/${DOCUMENT_ID}/`;
  if (USER) return `${USER}/`;
  return PREFIX || undefined;
}

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const VERSION_WITH_EXT_REGEX = new RegExp(`${UUID_V4}/(\\d+)\\..+$`);
const SKIP_PATTERNS = [/converted\.pdf$/, /^temp_files\//, /^ONBOARDING_DOCUMENTS\//];

function stripExtension(key: string): string {
  return key.replace(/(\d+)\..+$/, "$1");
}

function shouldDelete(key: string): boolean {
  if (!VERSION_WITH_EXT_REGEX.test(key)) return false;
  return !SKIP_PATTERNS.some((p) => p.test(key));
}

async function extensionlessExists(key: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: S3_BUCKET, Key: stripExtension(key) })
    );
    return true;
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      return false;
    }
    throw err;
  }
}

interface Stats {
  scanned: number;
  deleted: number;
  skipped: number;
  errors: number;
}

const stats: Stats = { scanned: 0, deleted: 0, skipped: 0, errors: 0 };

async function deleteBatch(keys: string[]): Promise<void> {
  // Verify extensionless copy exists before deleting
  const safeToDelete: string[] = [];
  await Promise.all(
    keys.map(async (key) => {
      if (await extensionlessExists(key)) {
        safeToDelete.push(key);
      } else {
        log(`SKIP (no extensionless copy): ${key}`);
        stats.skipped++;
      }
    })
  );

  if (safeToDelete.length === 0) return;

  if (DRY_RUN) {
    stats.deleted += safeToDelete.length;
    return;
  }

  // S3 DeleteObjects supports up to 1000 keys per call
  for (let i = 0; i < safeToDelete.length; i += 1000) {
    const batch = safeToDelete.slice(i, i + 1000);
    try {
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
            Quiet: true,
          },
        })
      );
      const errorCount = result.Errors?.length ?? 0;
      stats.deleted += batch.length - errorCount;
      if (errorCount > 0) {
        for (const err of result.Errors ?? []) {
          log(`ERROR deleting ${err.Key}: ${err.Message}`);
        }
        stats.errors += errorCount;
      }
    } catch (err) {
      log(`ERROR batch delete: ${err}`);
      stats.errors += batch.length;
    }
  }
}

async function deleteFromFile(filePath: string) {
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
      if (LIMIT !== undefined && stats.deleted + stats.skipped >= LIMIT) break;
      await deleteBatch(batch);
      batch = [];

      if (stats.scanned % 1000 === 0) {
        log(`... scanned=${stats.scanned} deleted=${stats.deleted} skipped=${stats.skipped}`);
      }
    }
  }

  if (batch.length > 0) {
    await deleteBatch(batch);
  }
}

function loadCursor(): string | undefined {
  if (USER || DOCUMENT_ID) return undefined;
  if (!existsSync(CURSOR_FILE)) return undefined;
  const cursor = readFileSync(CURSOR_FILE, "utf-8").trim();
  if (!cursor) return undefined;
  log(`Resuming from cursor: ${cursor}`);
  return cursor;
}

function saveCursor(lastKey: string) {
  if (DRY_RUN || USER || DOCUMENT_ID) return;
  writeFileSync(CURSOR_FILE, lastKey + "\n");
}

function clearCursor() {
  if (existsSync(CURSOR_FILE)) {
    writeFileSync(CURSOR_FILE, "");
  }
}

async function deleteFromScan() {
  log("Scanning bucket for keys to delete");

  const startAfter = loadCursor();
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: buildPrefix(),
        MaxKeys: PAGE_SIZE,
        ContinuationToken: continuationToken,
        ...(startAfter && !continuationToken ? { StartAfter: startAfter } : {}),
      })
    );

    const keys = (response.Contents ?? [])
      .filter((obj) => obj.Key)
      .map((obj) => obj.Key!);

    stats.scanned += keys.length;

    let toDelete = keys.filter(shouldDelete);

    if (LIMIT !== undefined) {
      const remaining = LIMIT - stats.deleted - stats.skipped;
      if (remaining <= 0) break;
      toDelete = toDelete.slice(0, remaining);
    }

    for (let i = 0; i < toDelete.length; i += CONCURRENCY) {
      const batch = toDelete.slice(i, i + CONCURRENCY);
      await deleteBatch(batch);
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey) saveCursor(lastKey);

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;

    if (continuationToken) {
      log(`... scanned=${stats.scanned} deleted=${stats.deleted} skipped=${stats.skipped}`);
    }
  } while (continuationToken);

  if (!DRY_RUN && !USER && !DOCUMENT_ID) clearCursor();
}

async function main() {
  log("=== Deleting old legacy S3 keys ===");
  log(`Bucket: ${S3_BUCKET}`);
  if (KEYS_FILE) log(`Keys file: ${KEYS_FILE}`);
  if (USER) log(`User: ${USER}`);
  if (DOCUMENT_ID) log(`Document: ${DOCUMENT_ID}`);
  if (DRY_RUN) log(`=== DRY RUN MODE ===${LIMIT ? ` (limit: ${LIMIT})` : ""}`);
  log(`Log file: ${LOG_FILE}`);

  if (KEYS_FILE) {
    await deleteFromFile(KEYS_FILE);
  } else {
    await deleteFromScan();
  }

  log("=== Delete complete ===");
  log(`Scanned: ${stats.scanned}`);
  log(`Deleted: ${stats.deleted}`);
  log(`Skipped: ${stats.skipped} (no extensionless copy found)`);
  log(`Errors:  ${stats.errors}`);
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});

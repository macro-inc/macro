#!/usr/bin/env bun
/**
 * Pull a document's raw Loro bytes and op log out of its DocumentSyncSession
 * durable object into local files.
 *
 * Auth uses the internal API key header, which the DO maps to
 * `AccessLevel::Admin` (see src/auth.rs), so no per-document JWT is needed.
 *
 * The base64 output is what the `loro-inspect` devtools page consumes: paste
 * `snapshot.loro.b64`, or `ops-all.b64` (one blob per line, applied in order).
 *
 * usage: bun scripts/dump-do-state.ts <document_id> [--env dev|prd|playground|local]
 *                                                   [--out DIR] [--url URL] [--key KEY]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** DO KV key prefixes, mirroring `src/storage/backends/durable_kv.rs`. */
const KV_PREFIXES = {
  /** `a/` — every op the DO has retained. Not full history: tracking was
   *  added partway through, so this cannot rebuild a document from zero. */
  'ops-all': 'a',
  /** `o/` — applied in memory but not yet folded into a snapshot. */
  'ops-pending': 'o',
  /** `LAST_VERSION_VECTOR`, written alongside each snapshot store. */
  'version-vector': 'L',
} as const;

const WORKER_URLS: Record<string, string> = {
  prd: 'https://sync-service-prod2.macroverse.workers.dev',
  dev: 'https://sync-service-dev3.macroverse.workers.dev',
  playground: 'https://sync-service-playground.macroverse.workers.dev',
  local: 'http://localhost:8787',
};

type Options = {
  documentId: string;
  targetEnv: string;
  outRoot: string;
  baseUrl: string;
  authKey: string | undefined;
};

function parseArguments(argv: string[]): Options {
  let documentId: string | undefined;
  let targetEnv = 'prd';
  let outRoot = './do-dump';
  let baseUrl: string | undefined;
  let authKey = process.env.SYNC_SERVICE_AUTH_KEY;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${argument} needs a value`);
      return value;
    };
    switch (argument) {
      case '--env':
        targetEnv = next();
        break;
      case '--out':
        outRoot = next();
        break;
      case '--url':
        baseUrl = next();
        break;
      case '--key':
        authKey = next();
        break;
      case '-h':
      case '--help':
        console.log(
          'usage: bun scripts/dump-do-state.ts <document_id> [--env dev|prd|playground|local] [--out DIR] [--url URL] [--key KEY]'
        );
        process.exit(0);
        break;
      default:
        if (argument.startsWith('-'))
          throw new Error(`unknown flag: ${argument}`);
        documentId = argument;
    }
  }

  if (targetEnv === 'prod') targetEnv = 'prd';
  if (!documentId) throw new Error('missing <document_id>');
  const resolvedUrl = baseUrl ?? WORKER_URLS[targetEnv];
  if (!resolvedUrl) {
    throw new Error(
      `unknown env: ${targetEnv} (use ${Object.keys(WORKER_URLS).join(', ')}, or pass --url)`
    );
  }
  return { documentId, targetEnv, outRoot, baseUrl: resolvedUrl, authKey };
}

async function run(command: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${command} failed: ${stderr.trim()}`);
  return stdout.trim();
}

/**
 * Doppler holds the *name* of the AWS Secrets Manager secret
 * (e.g. `sync-service-key-prod`), not the key, so deployed envs need both hops.
 */
async function resolveAuthKey(targetEnv: string): Promise<string> {
  const dopplerConfig =
    targetEnv === 'prd' || targetEnv === 'dev' ? targetEnv : 'lcl';
  const secretName = await run('doppler', [
    'secrets',
    'get',
    'SYNC_SERVICE_AUTH_KEY',
    '--plain',
    '--project',
    'cloud-storage-service',
    '--config',
    dopplerConfig,
  ]);
  if (dopplerConfig === 'lcl') return secretName;
  return run('aws', [
    'secretsmanager',
    'get-secret-value',
    '--secret-id',
    secretName,
    '--query',
    'SecretString',
    '--output',
    'text',
  ]);
}

class SyncServiceAdmin {
  constructor(
    private readonly baseUrl: string,
    private readonly documentId: string,
    private readonly authKey: string
  ) {}

  private async request(method: string, path: string): Promise<Response> {
    return fetch(`${this.baseUrl}/document/${this.documentId}${path}`, {
      method,
      headers: { 'x-internal-auth-key': this.authKey },
    });
  }

  async exists(): Promise<boolean> {
    return (await this.request('GET', '/exists')).status === 200;
  }

  /** Full `ExportMode::Snapshot` bytes: the document's own oplog plus state. */
  async snapshot(): Promise<Uint8Array> {
    const response = await this.request('POST', '/snapshot');
    if (!response.ok) throw new Error(`/snapshot returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async json(path: string): Promise<unknown> {
    const response = await this.request('GET', path);
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.json();
  }

  /**
   * List DO KV by key prefix. `matchit` binds `{prefix}` to a single path
   * segment, so `a/` cannot be passed literally — but the bare leading
   * character still prefix-matches every key under it in `storage.list()`.
   */
  async listKv(prefix: string): Promise<Array<[string, number[]]>> {
    return (await this.json(`/debug_do_kv_list/${prefix}`)) as Array<
      [string, number[]]
    >;
  }
}

type KvEntry = { index: number; key: string; bytes: number; base64: string };

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const authKey = options.authKey ?? (await resolveAuthKey(options.targetEnv));
  const client = new SyncServiceAdmin(
    options.baseUrl,
    options.documentId,
    authKey
  );

  console.log(
    `document ${options.documentId}  (${options.targetEnv} -> ${options.baseUrl})`
  );

  if (!(await client.exists())) {
    console.error('  /exists says no snapshot for this document');
    process.exit(1);
  }

  const outDir = join(options.outRoot, options.targetEnv, options.documentId);
  await mkdir(outDir, { recursive: true });

  const write = async (name: string, data: string | Uint8Array) => {
    await writeFile(join(outDir, name), data);
    const size =
      typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    console.log(`  ${name.padEnd(20)} ${size} bytes`);
  };

  const snapshot = await client.snapshot();
  await write('snapshot.loro', snapshot);
  await write('snapshot.loro.b64', Buffer.from(snapshot).toString('base64'));

  await write('raw.json', JSON.stringify(await client.json('/raw'), null, 2));
  await write(
    'metadata.json',
    JSON.stringify(await client.json('/metadata'), null, 2)
  );

  for (const [name, prefix] of Object.entries(KV_PREFIXES)) {
    const listed = await client.listKv(prefix);
    // DO `list()` returns keys in lexicographic order; op ids are
    // `{unix_nanos:016x}.{counter:08x}`, so this is only loosely chronological
    // (the counter resets when the DO restarts). Loro orders causally on import.
    const entries: KvEntry[] = listed
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, byteList], index) => ({
        index,
        key,
        bytes: byteList.length,
        base64: Buffer.from(byteList).toString('base64'),
      }));

    await write(`${name}.json`, JSON.stringify(entries, null, 2));
    await write(`${name}.b64`, entries.map((entry) => entry.base64).join('\n'));
    console.log(
      `  ${`${name}:`.padEnd(20)} ${entries.length} entries, ` +
        `${entries.reduce((total, entry) => total + entry.bytes, 0)} bytes`
    );
  }

  console.log(`wrote ${outDir}`);
  console.log(
    'paste snapshot.loro.b64 or ops-all.b64 into /app/component/loro-inspect'
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

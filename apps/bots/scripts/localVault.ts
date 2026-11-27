import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { dirname, join } from 'node:path';
import {
  type PasswordErrorCode,
  type PasswordPatchItem,
  type PasswordWriteItem,
  Sdk,
} from '@macro-inc/sdk/generated/storage';
import { canWriteSignedKind, itemFor } from '../src/passwords/signed-store';

export const vaultTeam = '0193a1b2-0000-7000-8000-0000000000aa';

const maxBody = 256 * 1024;
const uuid =
  /^(?!00000000-0000-0000-0000-000000000000)[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const metadataKeys = [
  'name',
  'kind',
  'favorite',
  'expectedVersion',
  'folderId',
  'url',
];

type VaultOperation =
  | { method: 'GET'; item?: string }
  | { method: 'POST'; item?: never }
  | { method: 'PUT' | 'PATCH'; item: string };

export function vaultOperation(
  req: Pick<IncomingMessage, 'method' | 'url'>,
  path: string
): VaultOperation | undefined {
  const collection = `${path}/vault/items`;
  if (req.url === collection) {
    if (req.method === 'GET' || req.method === 'POST') {
      return { method: req.method };
    }
    return;
  }
  if (!req.url?.startsWith(`${collection}/`)) return;
  const item = req.url.slice(collection.length + 1);
  if (!uuid.test(item)) return;
  if (req.method === 'GET' || req.method === 'PUT' || req.method === 'PATCH') {
    return { method: req.method, item };
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function optionalId(value: unknown): value is string | null | undefined {
  return value == null || (typeof value === 'string' && uuid.test(value));
}

function validMetadata(value: Record<string, unknown>) {
  return (
    typeof value.name === 'string' &&
    canWriteSignedKind(value.kind) &&
    typeof value.favorite === 'boolean' &&
    optionalId(value.folderId) &&
    (value.url == null || typeof value.url === 'string')
  );
}

function validVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 2_147_483_647
  );
}

function validSecrets(value: unknown): boolean {
  if (!object(value) || Object.keys(value).length !== 4) return false;
  return (
    typeof value.username === 'string' &&
    typeof value.password === 'string' &&
    typeof value.notes === 'string' &&
    Array.isArray(value.fields) &&
    value.fields.every(
      (field: unknown) =>
        object(field) &&
        Object.keys(field).length === 2 &&
        typeof field.label === 'string' &&
        typeof field.value === 'string'
    )
  );
}

export function isVaultWrite(
  value: unknown,
  method: 'POST' | 'PUT'
): value is PasswordWriteItem {
  if (!object(value)) return false;
  const allowed = [...metadataKeys, 'operationId', 'private', 'values'];
  return (
    Object.keys(value).every((key) => allowed.includes(key)) &&
    validMetadata(value) &&
    typeof value.operationId === 'string' &&
    uuid.test(value.operationId) &&
    value.operationId[14] === '7' &&
    value.private === true &&
    (method === 'POST'
      ? value.expectedVersion == null
      : validVersion(value.expectedVersion)) &&
    validSecrets(value.values)
  );
}

export function isVaultPatch(value: unknown): value is PasswordPatchItem {
  return (
    object(value) &&
    Object.keys(value).every((key) => metadataKeys.includes(key)) &&
    validMetadata(value) &&
    validVersion(value.expectedVersion)
  );
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const size = Number(req.headers['content-length']);
  if (
    req.headers['content-type'] !== 'application/json' ||
    req.headers['content-encoding'] ||
    req.headers['transfer-encoding'] ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > maxBody
  )
    return;
  const parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk)) return;
    length += chunk.length;
    if (length > size) return;
    parts.push(chunk);
  }
  if (length !== size) return;
  const body = Buffer.concat(parts, size);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return;
  } finally {
    body.fill(0);
    for (const part of parts) part.fill(0);
  }
}

const conflicts: readonly PasswordErrorCode[] = [
  'version_conflict',
  'vault_busy',
  'folder_missing',
  'vault_not_provisioned',
];

export function localVault() {
  // The reviewed local Rust listener records its owned ephemeral origin here.
  // Browser input can only select the exact catalog or a canonical item UUID.
  const originFile = process.env.BOTS_VAULT_ORIGIN_FILE;
  if (
    !originFile ||
    !/^\/tmp\/bots-vault-storage\.[A-Za-z0-9]+\/storage-origin$/.test(
      originFile
    ) ||
    realpathSync(originFile) !== originFile
  ) {
    throw new Error('A private vault origin receipt is required');
  }
  const owner = process.getuid?.();
  const directory = lstatSync(dirname(originFile));
  const receipt = lstatSync(originFile);
  if (
    owner === undefined ||
    !directory.isDirectory() ||
    !receipt.isFile() ||
    directory.uid !== owner ||
    receipt.uid !== owner ||
    (directory.mode & 0o077) !== 0 ||
    (receipt.mode & 0o077) !== 0 ||
    receipt.size > 64 ||
    Date.now() - receipt.mtimeMs >= 20 * 60_000
  ) {
    throw new Error('The private vault origin receipt is unavailable');
  }
  const processFile = join(dirname(originFile), 'storage-owner');
  const processReceipt = lstatSync(processFile);
  if (
    !processReceipt.isFile() ||
    processReceipt.uid !== owner ||
    (processReceipt.mode & 0o077) !== 0 ||
    processReceipt.size > 1024
  ) {
    throw new Error('A verified vault process receipt is required');
  }
  const storage: unknown = JSON.parse(readFileSync(processFile, 'utf8'));
  if (
    !object(storage) ||
    typeof storage.pid !== 'number' ||
    !Number.isSafeInteger(storage.pid) ||
    storage.pid <= 0 ||
    typeof storage.exe !== 'string' ||
    typeof storage.start !== 'string'
  ) {
    throw new Error('Invalid vault process receipt');
  }
  const proc = `/proc/${storage.pid}`;
  const live = () => {
    try {
      const stat = readFileSync(`${proc}/stat`, 'utf8');
      return (
        lstatSync(proc).uid === owner &&
        readlinkSync(`${proc}/exe`) === storage.exe &&
        stat
          .slice(stat.lastIndexOf(')') + 1)
          .trim()
          .split(/\s+/)[19] === storage.start &&
        Date.now() - receipt.mtimeMs < 20 * 60_000
      );
    } catch {
      return false;
    }
  };
  if (!live()) throw new Error('The reviewed vault process is unavailable');

  const baseUrl = readFileSync(originFile, 'utf8').trim();
  if (
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(baseUrl) ||
    new URL(baseUrl).origin !== baseUrl
  ) {
    throw new Error('A verified local vault listener is required');
  }
  const sdk = new Sdk();

  return async (
    req: IncomingMessage,
    operation: VaultOperation,
    token: string,
    recheck: () => Promise<boolean>
  ) => {
    const path = { team: vaultTeam };
    const options = {
      baseUrl,
      redirect: 'error' as const,
      signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${token}`, 'X-Macro-Passwords': '1' },
    };
    if (!live()) {
      return { status: 503, data: { code: 'vault_unavailable' } };
    }
    const item = operation.item;
    const method = operation.method;
    if (req.headers.authorization) {
      return { status: 403, data: { code: 'forbidden' } };
    }
    const body = method === 'GET' ? undefined : await readBody(req);
    let response;
    if (!(await recheck())) {
      return { status: 403, data: { code: 'forbidden' } };
    }
    if (!live()) return { status: 503, data: { code: 'vault_unavailable' } };
    if ((method === 'PUT' || method === 'PATCH') && item) {
      const existing = await sdk.passwordsDetail({
        ...options,
        path: { ...path, item },
      });
      if (!(await recheck()))
        return { status: 403, data: { code: 'forbidden' } };
      if (!live()) return { status: 503, data: { code: 'vault_unavailable' } };
      const metadata = itemFor(existing.data, vaultTeam);
      if (
        !metadata ||
        metadata.id !== item ||
        !metadata.canEdit ||
        !object(body) ||
        metadata.kind !== body.kind ||
        !canWriteSignedKind(metadata.kind)
      ) {
        return { status: 403, data: { code: 'forbidden' } };
      }
    }
    if (method === 'GET') {
      if (
        req.headers['transfer-encoding'] ||
        Number(req.headers['content-length'] ?? 0) !== 0
      ) {
        return { status: 400, data: { code: 'invalid_request' } };
      }
      response = item
        ? await sdk.passwordsDetail({ ...options, path: { ...path, item } })
        : await sdk.passwordsList({ ...options, path });
    } else if (method === 'POST' && isVaultWrite(body, method)) {
      response = await sdk.passwordsCreate({ ...options, path, body });
    } else if (method === 'PUT' && item && isVaultWrite(body, method)) {
      response = await sdk.passwordsUpdate({
        ...options,
        path: { ...path, item },
        body,
      });
    } else if (method === 'PATCH' && item && isVaultPatch(body)) {
      response = await sdk.passwordsPatch({
        ...options,
        path: { ...path, item },
        body,
      });
    } else {
      return { status: 400, data: { code: 'invalid_request' } };
    }

    if (!(await recheck())) return { status: 403, data: { code: 'forbidden' } };
    const status = response.response?.status;
    if (status === 401 || status === 403 || status === 404) {
      return {
        status,
        data: { code: status === 404 ? 'not_found' : 'forbidden' },
      };
    }
    if (status === 409) {
      const error: unknown = response.error;
      const code = conflicts.find(
        (conflict) => object(error) && error.code === conflict
      );
      if (code) return { status, data: { code } };
    }
    if (status === 200) {
      if (method === 'GET' && !item && Array.isArray(response.data)) {
        const value = response.data.map((entry) => itemFor(entry, vaultTeam));
        if (value.every((entry) => entry && uuid.test(entry.id))) {
          return {
            status,
            data: { status: 'ready', teamId: vaultTeam, value },
          };
        }
      } else {
        const value = itemFor(response.data, vaultTeam);
        const expected =
          item ?? (isVaultWrite(body, 'POST') ? body.operationId : undefined);
        if (value && expected && value.id === expected) {
          return {
            status,
            data: { status: 'ready', teamId: vaultTeam, value },
          };
        }
      }
    }
    return { status: 503, data: { code: 'vault_unavailable' } };
  };
}

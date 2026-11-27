import type {
  PasswordItemMetadata,
  PasswordPatchItem,
  PasswordWriteItem,
} from '@macro-inc/sdk/generated/storage';
import { kinds } from './storage';

export type SignedItem = Pick<
  PasswordItemMetadata,
  | 'id'
  | 'teamId'
  | 'name'
  | 'kind'
  | 'url'
  | 'folderId'
  | 'version'
  | 'favorite'
  | 'sharedWithTeam'
  | 'canEdit'
  | 'canManage'
>;

export function canWriteSignedKind(kind: unknown) {
  return kinds.some(
    (known) =>
      known === kind && known !== 'card' && known !== 'verification_code'
  );
}

export type SignedVaultResult<T> =
  | { status: 'ready'; value: T }
  | { status: 'signed-out' | 'denied' | 'stale' | 'unavailable' };

export type SignedSave =
  | { method: 'POST'; body: PasswordWriteItem }
  | { method: 'PUT'; id: SignedItem['id']; body: PasswordWriteItem }
  | { method: 'PATCH'; id: SignedItem['id']; body: PasswordPatchItem };

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function itemFor(value: unknown, team: string): SignedItem | undefined {
  if (!isObject(value) || value.teamId !== team) return;
  const { id, name, kind, url, folderId, version, favorite } = value;
  const { sharedWithTeam, canEdit, canManage } = value;
  const supportedKind = kinds.find((known) => known === kind);
  if (
    typeof id !== 'string' ||
    !uuid.test(id) ||
    typeof name !== 'string' ||
    !supportedKind ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    typeof favorite !== 'boolean' ||
    typeof sharedWithTeam !== 'boolean' ||
    typeof canEdit !== 'boolean' ||
    typeof canManage !== 'boolean'
  )
    return;
  return {
    id,
    teamId: team,
    name,
    kind: supportedKind,
    url: typeof url === 'string' ? url : null,
    folderId: typeof folderId === 'string' ? folderId : null,
    version,
    favorite,
    sharedWithTeam,
    canEdit,
    canManage,
  };
}

async function request<T>(
  team: string,
  parse: (value: unknown) => T | undefined,
  id?: string,
  save?: SignedSave
): Promise<SignedVaultResult<T>> {
  if (id && !uuid.test(id)) return { status: 'unavailable' };
  const suffix = id ? `/${id}` : '';
  try {
    const response = await fetch(
      `${__BOTS_LOCAL_AUTH__}/vault/items${suffix}`,
      {
        method: save?.method ?? 'GET',
        headers: save ? { 'Content-Type': 'application/json' } : undefined,
        body: save ? JSON.stringify(save.body) : undefined,
        credentials: 'same-origin',
        cache: 'no-store',
      }
    );
    if (response.status === 401) return { status: 'signed-out' };
    if (response.status === 403 || response.status === 404)
      return { status: 'denied' };
    const envelope: unknown = await response.json();
    if (
      response.status === 409 &&
      isObject(envelope) &&
      envelope.code === 'version_conflict'
    )
      return { status: 'stale' };
    if (
      !response.ok ||
      !isObject(envelope) ||
      envelope.status !== 'ready' ||
      envelope.teamId !== team
    )
      return { status: 'unavailable' };
    const value = parse(envelope.value);
    return value === undefined
      ? { status: 'unavailable' }
      : { status: 'ready', value };
  } catch {
    return { status: 'unavailable' };
  }
}

export const signedPasswordStorage = {
  list(team: string) {
    return request(team, (value) => {
      if (!Array.isArray(value)) return;
      const items = [];
      for (const entry of value) {
        const item = itemFor(entry, team);
        if (!item) return;
        items.push(item);
      }
      return items;
    });
  },
  detail(team: string, id: string) {
    return request(
      team,
      (value) => {
        const item = itemFor(value, team);
        return item?.id === id ? item : undefined;
      },
      id
    );
  },
  save(team: string, command: SignedSave) {
    const id = command.method === 'POST' ? undefined : command.id;
    const expected =
      id ?? (command.method === 'POST' ? command.body.operationId : undefined);
    return request(
      team,
      (value) => {
        const item = itemFor(value, team);
        return item?.id === expected ? item : undefined;
      },
      id,
      command
    );
  },
};

import { err, ok } from 'neverthrow';
import type { PasswordSource } from '../context/passwords-context';
import type {
  PasswordFolder,
  PasswordGrant,
  PasswordItem,
  PasswordValues,
} from '../core/types';

export function createFakePasswordSource(): PasswordSource {
  let items: PasswordItem[] = [];
  const folders: PasswordFolder[] = [];
  const values = new Map<string, PasswordValues>();
  const grants = new Map<string, PasswordGrant[]>();
  return {
    async list() {
      return [...items];
    },
    async folders() {
      return [...folders];
    },
    async save(id, version, draft, operationId) {
      const timestamp = new Date().toISOString();
      const itemId = id ?? operationId;
      const currentGrants = grants.get(itemId) ?? [];
      const item: PasswordItem = {
        id: itemId,
        teamId: 'fixture-team',
        name: draft.name,
        kind: draft.kind,
        url: draft.url,
        folderId: draft.folderId,
        favorite: draft.favorite,
        shared: currentGrants.length > 0,
        shareCount: currentGrants.length,
        version: (version ?? 0) + 1,
        hasTotp: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastUsedAt: null,
      };
      items = [...items.filter((existing) => existing.id !== item.id), item];
      values.set(item.id, draft.values);
      return ok(item);
    },
    async move(item, folderId) {
      const updated = { ...item, folderId };
      items = items.map((existing) =>
        existing.id === item.id ? updated : existing
      );
      return ok(updated);
    },
    async remove(id) {
      items = items.filter((item) => item.id !== id);
      values.delete(id);
      return ok(undefined);
    },
    async reveal(id, version) {
      const secret = values.get(id);
      if (!secret) return err('failed');
      return ok({ values: secret, version: version ?? 1 });
    },
    async username(id) {
      const secret = values.get(id);
      const item = items.find((item) => item.id === id);
      if (!secret || !item) return err('failed');
      return ok({ username: secret.username, version: item.version });
    },
    async copyUsername(id) {
      const secret = values.get(id);
      const item = items.find((item) => item.id === id);
      if (!secret || !item) return err('failed');
      return ok({ username: secret.username, version: item.version });
    },
    async copy(id) {
      const secret = values.get(id);
      if (!secret) return err('failed');
      return ok({ values: secret, version: 1 });
    },
    async history() {
      return ok([{ version: 1, createdAt: new Date().toISOString() }]);
    },
    async activity() {
      return ok([
        {
          id: 'fixture-create-event',
          action: 'create',
          occurredAt: '2026-11-06T21:00:00Z',
        },
      ]);
    },
    async grants(id) {
      return ok(grants.get(id) ?? []);
    },
    async share(id, next) {
      grants.set(id, next);
      items = items.map((item) =>
        item.id === id
          ? { ...item, shared: next.length > 0, shareCount: next.length }
          : item
      );
      return ok(undefined);
    },
    async createFolder(name) {
      const folder = { id: crypto.randomUUID(), name };
      folders.push(folder);
      return ok(folder);
    },
    async setTotp() {
      return ok(undefined);
    },
    async removeTotp() {
      return ok(undefined);
    },
    async totp() {
      return ok({
        code: '123456',
        validUntil: new Date(Date.now() + 30000).toISOString(),
      });
    },
    async logo() {
      return err('failed');
    },
  };
}

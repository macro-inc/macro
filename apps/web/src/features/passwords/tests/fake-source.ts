import { err, ok } from 'neverthrow';
import type { PasswordSource } from '../context/passwords-context';
import {
  folderSubtree,
  type PasswordFolder,
  type PasswordGrant,
  type PasswordItem,
  type PasswordValues,
} from '../core/types';

/** An item the fake starts with, such as one the viewer may only view. */
export type FakeSeed = { item: PasswordItem; values: PasswordValues };

export function createFakePasswordSource(
  seed: FakeSeed[] = []
): PasswordSource {
  let items: PasswordItem[] = seed.map((entry) => entry.item);
  let folders: PasswordFolder[] = [];
  const values = new Map<string, PasswordValues>(
    seed.map((entry) => [entry.item.id, entry.values])
  );
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
        sharedWithTeam: id
          ? (items.find((item) => item.id === id)?.sharedWithTeam ?? true)
          : !draft.private,
        canManage: true,
        canEdit: true,
        version: (version ?? 0) + 1,
        hasTotp: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastUsedAt: null,
      };
      items = [...items.filter((existing) => existing.id !== item.id), item];
      // Stored like the server's JSON: a copy, never the caller's live draft.
      values.set(item.id, JSON.parse(JSON.stringify(draft.values)));
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
    async createFolder(name, parentId) {
      if (parentId && !folders.some((folder) => folder.id === parentId))
        return err('failed');
      const folder = { id: crypto.randomUUID(), name, parentId };
      folders.push(folder);
      return ok(folder);
    },
    async renameFolder(id, name) {
      const current = folders.find((folder) => folder.id === id);
      if (!current) return err('failed');
      const renamed = { ...current, name };
      folders = folders.map((folder) => (folder.id === id ? renamed : folder));
      return ok(renamed);
    },
    async moveFolder(id, parentId) {
      const current = folders.find((folder) => folder.id === id);
      if (!current || (parentId && folderSubtree(folders, id).has(parentId)))
        return err('failed');
      const moved = { ...current, parentId };
      folders = folders.map((folder) => (folder.id === id ? moved : folder));
      return ok(moved);
    },
    async deleteFolder(id) {
      if (!folders.some((folder) => folder.id === id)) return err('failed');
      const removed = folderSubtree(folders, id);
      folders = folders.filter((folder) => !removed.has(folder.id));
      items = items.map((item) =>
        item.folderId && removed.has(item.folderId)
          ? { ...item, folderId: null }
          : item
      );
      return ok(undefined);
    },
    async setTotp(id) {
      items = items.map((item) =>
        item.id === id ? { ...item, hasTotp: true } : item
      );
      return ok(undefined);
    },
    async removeTotp() {
      return ok(undefined);
    },
    async totp() {
      return ok({
        code: '123456',
        validUntil: new Date(Date.now() + 30000).toISOString(),
        period: 30,
      });
    },
    async logo() {
      return err('failed');
    },
  };
}

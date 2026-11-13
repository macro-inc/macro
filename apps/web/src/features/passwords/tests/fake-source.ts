import { err, ok } from 'neverthrow';
import type {
  ImportBatchBody,
  ImportBatchResult,
  ImportRequestFailure,
  PasswordSource,
} from '../context/passwords-context';
import {
  folderSubtree,
  type PasswordFolder,
  type PasswordGrant,
  type PasswordItem,
  type PasswordValues,
} from '../core/types';

/** An item the fake starts with, such as one the viewer may only view. */
export type FakeSeed = { item: PasswordItem; values: PasswordValues };

/** Scripted import answers: busy rounds per source key, failed requests. */
export type FakeImportScript = {
  busy?: Map<string, number>;
  /**
   * Items whose verification code setup fails this many times: the item is
   * created and answered failed with its id, as the vault does. A later send
   * of the same item finishes the setup.
   */
  totpFailures?: Map<string, number>;
  /** Items answered `folder_missing` this many times, as if their folder were deleted mid-batch. */
  folderMissing?: Map<string, number>;
  failRequests?: number;
  /** Names of each duplicate-match request, in order. */
  matchRequests?: string[][];
  /** How the failed requests fail; retryable unless set. */
  failWith?: ImportRequestFailure;
  requests?: ImportBatchBody[];
};

export function createFakePasswordSource(
  seed: FakeSeed[] = [],
  script: FakeImportScript = {}
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
    async matchNames(names) {
      script.matchRequests?.push([...names]);
      const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
      return ok(
        items.filter((item) => wanted.has(item.name.trim().toLowerCase()))
      );
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
    async importBatch(importId, batch) {
      script.requests?.push(structuredClone(batch));
      if (script.failRequests && script.failRequests > 0) {
        script.failRequests--;
        return err(script.failWith ?? 'retryable');
      }
      let targetFolderId: string | null = null;
      if (batch.target.kind === 'new') {
        const id = `${importId}:target`;
        if (!folders.some((folder) => folder.id === id))
          folders.push({ id, name: batch.target.name, parentId: null });
        targetFolderId = id;
      } else if (batch.target.kind === 'existing') {
        targetFolderId = batch.target.folderId;
      }
      const folderIds = new Map<string, string>();
      for (const source of batch.folders) {
        const id = `${importId}:${source.key}`;
        const parentId = source.parentKey
          ? (folderIds.get(source.parentKey) ?? null)
          : targetFolderId;
        if (!folders.some((folder) => folder.id === id))
          folders.push({ id, name: source.name, parentId });
        folderIds.set(source.key, id);
      }
      const answers: ImportBatchResult['items'] = batch.items.map((entry) => {
        const busy = script.busy?.get(entry.sourceKey) ?? 0;
        if (busy > 0) {
          script.busy?.set(entry.sourceKey, busy - 1);
          return {
            sourceKey: entry.sourceKey,
            outcome: 'failed',
            errorCode: 'busy',
          };
        }
        const missing = script.folderMissing?.get(entry.sourceKey) ?? 0;
        if (missing > 0) {
          script.folderMissing?.set(entry.sourceKey, missing - 1);
          return {
            sourceKey: entry.sourceKey,
            outcome: 'failed',
            errorCode: 'folder_missing',
          };
        }
        const id = `${importId}:${entry.sourceKey}`;
        const totpFails = (script.totpFailures?.get(entry.sourceKey) ?? 0) > 0;
        if (totpFails)
          script.totpFailures?.set(
            entry.sourceKey,
            (script.totpFailures?.get(entry.sourceKey) ?? 1) - 1
          );
        const enrolled = entry.totp !== null && !totpFails;
        if (items.some((item) => item.id === id)) {
          if (totpFails)
            return {
              sourceKey: entry.sourceKey,
              outcome: 'failed',
              errorCode: 'vault_unavailable',
              itemId: id,
            };
          items = items.map((item) =>
            item.id === id && enrolled ? { ...item, hasTotp: true } : item
          );
          return {
            sourceKey: entry.sourceKey,
            outcome: 'already_present',
            itemId: id,
          };
        }
        const timestamp = new Date().toISOString();
        items = [
          ...items,
          {
            id,
            teamId: 'fixture-team',
            name: entry.name,
            kind: entry.kind,
            url: entry.url,
            folderId: entry.folderKey
              ? (folderIds.get(entry.folderKey) ?? null)
              : targetFolderId,
            favorite: entry.favorite,
            shared: false,
            shareCount: 0,
            sharedWithTeam: !batch.private,
            canManage: true,
            canEdit: true,
            version: 1,
            hasTotp: enrolled,
            createdAt: timestamp,
            updatedAt: timestamp,
            lastUsedAt: null,
          },
        ];
        values.set(id, structuredClone(entry.values));
        if (totpFails)
          return {
            sourceKey: entry.sourceKey,
            outcome: 'failed',
            errorCode: 'vault_unavailable',
            itemId: id,
          };
        return { sourceKey: entry.sourceKey, outcome: 'created', itemId: id };
      });
      return ok({
        targetFolderId,
        folders: [...folderIds].map(([key, folderId]) => ({ key, folderId })),
        items: answers,
      });
    },
  };
}

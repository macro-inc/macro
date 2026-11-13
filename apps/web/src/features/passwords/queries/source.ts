import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import { sleep } from '@core/util/sleep';
import { Telemetry } from '@macro-inc/observability';
import type { PasswordActivity as ActivityDto } from '@service-storage/generated/schemas/passwordActivity';
import type { PasswordCreateFolderBody } from '@service-storage/generated/schemas/passwordCreateFolderBody';
import { PasswordErrorCode } from '@service-storage/generated/schemas/passwordErrorCode';
import type { PasswordFolder as FolderDto } from '@service-storage/generated/schemas/passwordFolder';
import type { PasswordFolderBody } from '@service-storage/generated/schemas/passwordFolderBody';
import type { PasswordGrant as GrantDto } from '@service-storage/generated/schemas/passwordGrant';
import type { PasswordImportBatch } from '@service-storage/generated/schemas/passwordImportBatch';
import type { PasswordImportBatchResult } from '@service-storage/generated/schemas/passwordImportBatchResult';
import type { PasswordItemMetadata } from '@service-storage/generated/schemas/passwordItemMetadata';
import type { PasswordMoveFolderBody } from '@service-storage/generated/schemas/passwordMoveFolderBody';
import type { PasswordPatchItem } from '@service-storage/generated/schemas/passwordPatchItem';
import type { PasswordRevealBody } from '@service-storage/generated/schemas/passwordRevealBody';
import type { PasswordRevealed } from '@service-storage/generated/schemas/passwordRevealed';
import type { PasswordShareBody } from '@service-storage/generated/schemas/passwordShareBody';
import type { PasswordTotpBody } from '@service-storage/generated/schemas/passwordTotpBody';
import type { PasswordTotpCode } from '@service-storage/generated/schemas/passwordTotpCode';
import type { PasswordUsername } from '@service-storage/generated/schemas/passwordUsername';
import type { PasswordVersion as VersionDto } from '@service-storage/generated/schemas/passwordVersion';
import type { PasswordWriteItem } from '@service-storage/generated/schemas/passwordWriteItem';
import { err, ok } from 'neverthrow';
import type {
  ImportBatchResult,
  PasswordFailure,
  PasswordResult,
  PasswordSource,
} from '../context/passwords-context';
import type { PasswordFolder, PasswordItem } from '../core/types';

function metadata(item: PasswordItemMetadata): PasswordItem {
  return {
    ...item,
    url: item.url ?? null,
    folderId: item.folderId ?? null,
    lastUsedAt: item.lastUsedAt ?? null,
  };
}

/** A read that finished after the viewer's account or session changed. */
class PasswordScopeChangedError extends Error {
  constructor() {
    super('Passwords viewer changed');
  }
}

function folder(dto: FolderDto): PasswordFolder {
  return { id: dto.id, name: dto.name, parentId: dto.parentId ?? null };
}

/**
 * Busy retries outlast one vault write holding the team lock (about a second
 * under load): the jittered waits add up to between 1.5 and 4.5 seconds.
 */
const BUSY_RETRIES = 4;
const BUSY_BACKOFF_MS = 200;

function failure(codes: readonly (string | undefined)[]): PasswordFailure {
  if (codes.includes(PasswordErrorCode.folder_missing)) return 'folderMissing';
  return 'failed';
}

/**
 * The viewer the source serves. `signal` aborts when that viewer's account or
 * session changes, so a request waiting on a session refresh is never replayed
 * for the next viewer.
 */
export type PasswordSourceScope = {
  isCurrent: () => boolean;
  signal: AbortSignal;
};

export function createPasswordSource(
  teamId: string,
  scope: PasswordSourceScope
): PasswordSource {
  const isCurrent = () => !scope.signal.aborted && scope.isCurrent();
  const root = `${SERVER_HOSTS['document-storage-service']}/passwords/teams/${encodeURIComponent(teamId)}`;
  async function request<T extends object>(
    path: string,
    method: string,
    body?: object
  ): PasswordResult<T> {
    const payload = body ? JSON.stringify(body) : undefined;
    return Telemetry.span('passwords.request', async (span) => {
      for (let retries = 0; ; retries++) {
        // Never send or finish a request for a viewer that has since changed.
        if (!isCurrent()) return err('failed' as const);
        span.setAttr('retry.count', retries);
        const response = await fetchWithToken<T, PasswordErrorCode>(
          `${root}${path}`,
          {
            method,
            headers: {
              'Content-Type': 'application/json',
              'X-Macro-Passwords': '1',
            },
            body: payload,
            signal: scope.signal,
            retry: { maxTries: 1 },
            trace: { parentSpan: span },
            errorResponseHandler: async (response) => {
              const fallback = statusError(response.status);
              if (response.status !== 403 && response.status !== 409)
                return fallback;
              const failure: unknown = await response
                .json()
                .catch(() => undefined);
              if (
                !failure ||
                typeof failure !== 'object' ||
                !('code' in failure)
              )
                return fallback;
              const code = Object.values(PasswordErrorCode).find(
                (code) => code === failure.code
              );
              return code ? { code, message: code } : fallback;
            },
          }
        );
        // A response for a viewer that has since changed is dropped, busy or not.
        if (!isCurrent()) return err('failed' as const);
        if (
          response.isErr() &&
          retries < BUSY_RETRIES &&
          response.error.some(
            (error) => error.code === PasswordErrorCode.vault_busy
          )
        ) {
          await sleep(BUSY_BACKOFF_MS * 2 ** retries * (0.5 + Math.random()));
          continue;
        }
        return response.mapErr((errors) =>
          failure(errors.map((error) => error.code))
        );
      }
    });
  }
  async function action<T extends object>(
    name: string,
    path: string,
    method: string,
    body?: object
  ): PasswordResult<T> {
    return Telemetry.span(name, async () => request<T>(path, method, body));
  }
  /**
   * A code is only known to belong to the period the request started in if
   * the response arrives in that same period. Across a boundary it may be the
   * previous period's code, so ask once more; never publish a code that could
   * already be expired.
   */
  async function currentCode(id: string) {
    // One action trace across the attempts; only the attempt count is recorded.
    return Telemetry.span('passwords.totp_code', async (span) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        span.setAttr('passwords.totp.attempts', attempt + 1);
        const requestedAt = Date.now();
        const result = await span.run(() =>
          request<PasswordTotpCode>(`/items/${id}/totp/code`, 'POST', {})
        );
        if (result.isErr()) return err(result.error);
        const { code, period } = result.value;
        const periodMs = period * 1000;
        const window = Math.floor(requestedAt / periodMs);
        if (Math.floor(Date.now() / periodMs) !== window) continue;
        return ok({
          code,
          period,
          validUntil: new Date((window + 1) * periodMs).toISOString(),
        });
      }
      span.setAttr('passwords.outcome', 'period_boundary');
      return err('failed' as const);
    });
  }
  return {
    async list() {
      if (!isCurrent()) throw new PasswordScopeChangedError();
      const items = await throwOnErr(() =>
        fetchWithToken<PasswordItemMetadata[]>(`${root}/items`, {
          signal: scope.signal,
        })
      );
      if (!isCurrent()) throw new PasswordScopeChangedError();
      return items.map(metadata);
    },
    async search(text) {
      if (!isCurrent()) return err('failed' as const);
      const items = await fetchWithToken<PasswordItemMetadata[]>(
        `${root}/items?search=${encodeURIComponent(text)}`,
        { signal: scope.signal, retry: { maxTries: 1 } }
      );
      if (items.isErr() || !isCurrent()) return err('failed' as const);
      return ok(items.value.map(metadata));
    },
    async folders() {
      if (!isCurrent()) throw new PasswordScopeChangedError();
      const folders = await throwOnErr(() =>
        fetchWithToken<FolderDto[]>(`${root}/folders`, {
          signal: scope.signal,
        })
      );
      if (!isCurrent()) throw new PasswordScopeChangedError();
      return folders.map(folder);
    },
    async save(id, version, draft, operationId) {
      return (
        await action<PasswordItemMetadata>(
          id ? 'passwords.update' : 'passwords.create',
          id ? `/items/${id}` : '/items',
          id ? 'PUT' : 'POST',
          {
            name: draft.name,
            kind: draft.kind,
            url: draft.url || null,
            folderId: draft.folderId,
            favorite: draft.favorite,
            // Sharing is set once at creation; later changes go through Share.
            ...(id ? {} : { private: draft.private }),
            values: draft.values,
            expectedVersion: version ?? null,
            operationId,
          } satisfies PasswordWriteItem
        )
      ).map(metadata);
    },
    async move(item, folderId) {
      return (
        await request<PasswordItemMetadata>(`/items/${item.id}`, 'PATCH', {
          name: item.name,
          kind: item.kind,
          url: item.url,
          folderId,
          favorite: item.favorite,
          expectedVersion: item.version,
        } satisfies PasswordPatchItem)
      ).map(metadata);
    },
    grants(id) {
      return request<GrantDto[]>(`/items/${id}/share`, 'GET');
    },
    async remove(id) {
      return (await action('passwords.delete', `/items/${id}`, 'DELETE')).map(
        () => undefined
      );
    },
    username(id) {
      return action<PasswordUsername>(
        'passwords.username',
        `/items/${id}/username`,
        'GET'
      );
    },
    copyUsername(id) {
      return action<PasswordUsername>(
        'passwords.copy_username',
        `/items/${id}/username/copy`,
        'POST'
      );
    },
    reveal(id, version) {
      return action<PasswordRevealed>(
        'passwords.reveal',
        `/items/${id}/reveal`,
        'POST',
        { version } satisfies PasswordRevealBody
      );
    },
    copy(id) {
      return action<PasswordRevealed>(
        'passwords.copy',
        `/items/${id}/copy`,
        'POST',
        {}
      );
    },
    history(id) {
      return request<VersionDto[]>(`/items/${id}/history`, 'GET');
    },
    activity(id) {
      return request<ActivityDto[]>(`/items/${id}/activity`, 'GET');
    },
    async share(id, grants) {
      return (
        await action('passwords.share', `/items/${id}/share`, 'PUT', {
          grants,
        } satisfies PasswordShareBody)
      ).map(() => undefined);
    },
    async createFolder(name, parentId) {
      return Telemetry.span('passwords.folder.create', async (span) => {
        const result = await request<FolderDto>('/folders', 'POST', {
          name,
          parentId,
        } satisfies PasswordCreateFolderBody);
        if (result.isErr()) {
          span.setAttr('passwords.outcome', result.error);
          // Record only the failure category, never the folder name.
          span.error('passwords.folder.create failed');
        }
        return result.map(folder);
      });
    },
    async renameFolder(id, name) {
      return (
        await action<FolderDto>(
          'passwords.folder.rename',
          `/folders/${id}`,
          'PUT',
          { name } satisfies PasswordFolderBody
        )
      ).map(folder);
    },
    async moveFolder(id, parentId) {
      return (
        await action<FolderDto>(
          'passwords.folder.move',
          `/folders/${id}/parent`,
          'PUT',
          { parentId } satisfies PasswordMoveFolderBody
        )
      ).map(folder);
    },
    async deleteFolder(id) {
      return (
        await action('passwords.folder.delete', `/folders/${id}`, 'DELETE')
      ).map(() => undefined);
    },
    async setTotp(id, key) {
      return (
        await request(`/items/${id}/totp`, 'PUT', {
          key,
        } satisfies PasswordTotpBody)
      ).map(() => undefined);
    },
    async removeTotp(id) {
      return (await request(`/items/${id}/totp`, 'DELETE')).map(
        () => undefined
      );
    },
    totp(id) {
      return currentCode(id);
    },
    async importBatch(importId, batch) {
      // Spanned by the caller's `passwords.import`; values never reach attributes.
      return (
        await request<PasswordImportBatchResult>(
          `/imports/${encodeURIComponent(importId)}/items`,
          'POST',
          batch satisfies PasswordImportBatch
        )
      ).map(
        (result): ImportBatchResult => ({
          targetFolderId: result.targetFolderId ?? null,
          folders: result.folders,
          items: result.items.map((item) => ({
            sourceKey: item.sourceKey,
            outcome: item.outcome,
            errorCode: item.errorCode ?? undefined,
            itemId: item.itemId ?? undefined,
          })),
        })
      );
    },
    async logo(domain) {
      const response = await fetchWithToken<Uint8Array>(
        `${SERVER_HOSTS['image-proxy-service']}/logos?domain=${encodeURIComponent(domain)}`,
        { retry: { maxTries: 1 }, signal: scope.signal }
      );
      if (response.isErr() || !isCurrent()) return err('failed');
      return ok(
        URL.createObjectURL(new Blob([new Uint8Array(response.value)]))
      );
    },
  };
}

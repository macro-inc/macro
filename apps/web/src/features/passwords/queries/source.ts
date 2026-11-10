import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import { sleep } from '@core/util/sleep';
import { Telemetry } from '@macro-inc/observability';
import type { PasswordActivity as ActivityDto } from '@service-storage/generated/schemas/passwordActivity';
import { PasswordErrorCode } from '@service-storage/generated/schemas/passwordErrorCode';
import type { PasswordFolder as FolderDto } from '@service-storage/generated/schemas/passwordFolder';
import type { PasswordFolderBody } from '@service-storage/generated/schemas/passwordFolderBody';
import type { PasswordGrant as GrantDto } from '@service-storage/generated/schemas/passwordGrant';
import type { PasswordItemMetadata } from '@service-storage/generated/schemas/passwordItemMetadata';
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
  PasswordFailure,
  PasswordResult,
  PasswordSource,
} from '../context/passwords-context';
import type { PasswordItem } from '../core/types';

function metadata(item: PasswordItemMetadata): PasswordItem {
  return {
    ...item,
    url: item.url ?? null,
    folderId: item.folderId ?? null,
    lastUsedAt: item.lastUsedAt ?? null,
  };
}

export function createPasswordSource(teamId: string): PasswordSource {
  const root = `${SERVER_HOSTS['document-storage-service']}/passwords/teams/${encodeURIComponent(teamId)}`;
  async function request<T extends object>(
    path: string,
    method: string,
    body?: object
  ): PasswordResult<T> {
    const payload = body ? JSON.stringify(body) : undefined;
    return Telemetry.span('passwords.request', async (span) => {
      for (let retries = 0; ; retries++) {
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
        if (
          response.isErr() &&
          retries < 2 &&
          response.error.some(
            (error) => error.code === PasswordErrorCode.vault_busy
          )
        ) {
          await sleep(100 * 2 ** retries * (0.5 + Math.random()));
          continue;
        }
        return response.mapErr(
          (errors): PasswordFailure =>
            errors.some(
              (error) =>
                error.code === PasswordErrorCode.reauthentication_required
            )
              ? 'reauth'
              : 'failed'
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
  async function currentCode(id: string) {
    const result = await request<PasswordTotpCode>(
      `/items/${id}/totp/code`,
      'POST',
      {}
    );
    return result.map(({ code, period }) => ({
      code,
      validUntil: new Date(
        (Math.floor(Date.now() / (period * 1000)) + 1) * period * 1000
      ).toISOString(),
    }));
  }
  return {
    async list() {
      const items = await throwOnErr(() =>
        fetchWithToken<PasswordItemMetadata[]>(`${root}/items`)
      );
      return items.map(metadata);
    },
    async folders() {
      return throwOnErr(() => fetchWithToken<FolderDto[]>(`${root}/folders`));
    },
    async save(id, version, draft, operationId) {
      return (
        await action<PasswordItemMetadata>(
          id ? 'passwords.update' : 'passwords.create',
          id ? `/items/${id}` : '/items',
          id ? 'PUT' : 'POST',
          {
            ...draft,
            url: draft.url || null,
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
    createFolder(name) {
      return request<FolderDto>('/folders', 'POST', {
        name,
      } satisfies PasswordFolderBody);
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
    async logo(domain) {
      const response = await fetchWithToken<Uint8Array>(
        `${SERVER_HOSTS['image-proxy-service']}/logos?domain=${encodeURIComponent(domain)}`,
        { retry: { maxTries: 1 } }
      );
      if (response.isErr()) return err('failed');
      return ok(
        URL.createObjectURL(new Blob([new Uint8Array(response.value)]))
      );
    },
  };
}

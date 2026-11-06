import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import type { PasswordActivity as ActivityDto } from '@service-storage/generated/schemas/passwordActivity';
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
    const response = await fetchWithToken<T>(`${root}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Macro-Passwords': '1' },
      body: body ? JSON.stringify(body) : undefined,
      retry: { maxTries: 1 },
    });
    return response.mapErr((errors): PasswordFailure => {
      if (errors.some((error) => error.code === 'UNAUTHORIZED'))
        return 'reauth';
      return 'failed';
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

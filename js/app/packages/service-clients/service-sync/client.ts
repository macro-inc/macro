import { SYNC_SERVICE_HOSTS } from '@core/constant/servers';
import { getPermissionToken } from '@core/signal/token';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  isErr,
  type MaybeError,
  type MaybeResult,
  type ObjectLike,
  ok,
} from '@core/util/maybeResult';
import { isTauri } from '@core/util/platform';
import { platformFetch } from '@core/util/platformFetch';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { SerializedEditorState } from 'lexical';
import { InitializeFromSnapshotRequest } from './generated/schema';

const SYNC_SERVICE_WORKER_URL = `${SYNC_SERVICE_HOSTS['worker']}`;

const SYNC_ORIGIN =
  import.meta.env.MODE === 'development'
    ? 'https://dev.macro.com'
    : 'https://macro.com';

const WAKEUP_TTL = 55 * 1000; // 55 seconds - cloudflare ttl is 60

const pendingWakeups = new Map<string, ReturnType<typeof setTimeout>>();
const recentWakeups = new Map<string, number>();

export function syncFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function syncFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function syncFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${SYNC_SERVICE_WORKER_URL}${url}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(isTauri() && { Origin: SYNC_ORIGIN }),
    },
  });
}

type MetadataResponse = {
  peers: Array<{
    peer_id: number;
    user_id: string;
  }>;
};

export const syncServiceClient = {
  async wakeup(args: { documentId: string }) {
    await syncFetch(`/document/${args.documentId}/wakeup`, {
      method: 'GET',
    });
  },
  async safeWakeup(id: string, delay: number = 200) {
    const lastWakeup = recentWakeups.get(id);
    if (lastWakeup && Date.now() - lastWakeup < WAKEUP_TTL) {
      return;
    }

    const existingTimeout = pendingWakeups.get(id);
    if (existingTimeout) {
      // let the first timeout handle it.
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        await syncFetch(`/document/${id}/wakeup`, {
          method: 'GET',
        });
        recentWakeups.set(id, Date.now());

        // prune
        const now = Date.now();
        for (const [key, timestamp] of recentWakeups.entries()) {
          if (now - timestamp >= WAKEUP_TTL) {
            recentWakeups.delete(key);
          }
        }
      } catch (error) {
        console.error(`Failed to wakeup document ${id}:`, error);
      } finally {
        pendingWakeups.delete(id);
      }
    }, delay);

    pendingWakeups.set(id, timeout);
  },
  cancelWakeup(id: string) {
    const timeout = pendingWakeups.get(id);
    if (timeout) {
      clearTimeout(timeout);
      pendingWakeups.delete(id);
    }
  },
  async exists(args: { documentId: string }) {
    const res = await syncFetch(`/document/${args.documentId}/exists`, {
      method: 'GET',
    });

    if (isErr(res)) {
      if (isErr(res, 'NOT_FOUND')) {
        return ok({ exists: false });
      }
      return res;
    }

    return ok({ exists: true });
  },
  async initializeFromSnapshot(args: {
    documentId: string;
    snapshot: Uint8Array;
  }) {
    const token = await getPermissionToken('document', args.documentId);
    const req = InitializeFromSnapshotRequest.encode({
      snapshot: args.snapshot,
    }) as Uint8Array<ArrayBuffer>;

    return await syncFetch(`/document/${args.documentId}/initialize`, {
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${token}`,
      },
      method: 'POST',
      body: req,
    });
  },
  async getDocumentMetadata(args: { documentId: string }) {
    const token = await getPermissionToken('document', args.documentId);

    const response = await syncFetch<MetadataResponse>(
      `/document/${args.documentId}/metadata`,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${token}`,
        },
        method: 'GET',
      }
    );
    if (isErr(response)) {
      if (isErr(response, 'NOT_FOUND')) {
        return response;
      }
    }

    return ok(response[1] as MetadataResponse);
  },
  async getSnapshot(args: { documentId: string }) {
    const token = await getPermissionToken('document', args.documentId);
    const response = await platformFetch(
      `${SYNC_SERVICE_WORKER_URL}/document/${args.documentId}/snapshot`,
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${token}`,
        },
        method: 'GET',
      }
    );

    const data = await response.arrayBuffer();

    const array = new Uint8Array(data);

    return ok(array);
  },
  async getRaw(args: { documentId: string }): Promise<SerializedEditorState> {
    const token = await getPermissionToken('document', args.documentId);
    const response = await platformFetch(
      `${SYNC_SERVICE_WORKER_URL}/document/${args.documentId}/raw`,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        method: 'GET',
      }
    );
    if (!response.ok) {
      try {
        console.error('Failed to fetch raw document', await response.text());
      } catch (_e) {
        console.error('Failed to fetch raw document');
      }
      throw new Error('Failed to fetch raw document');
    }
    const state = await response.json();
    return state;
  },
};

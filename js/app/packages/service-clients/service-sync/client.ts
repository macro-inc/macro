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

const WAKEUP_TTL = 55 * 1000;
const WAKEUP_DEBOUNCE_MS = 200;

const pendingWakeups = new Map<
  string,
  { debounceTimer: ReturnType<typeof setTimeout>; idleTaskId?: number }
>();
const recentWakeups = new Map<string, number>();

const scheduleIdleTask =
  typeof window !== 'undefined' && window.requestIdleCallback
    ? (cb: () => void) => window.requestIdleCallback(cb)
    : (cb: () => void) => window.setTimeout(cb, 0) as unknown as number;

const cancelIdleTask =
  typeof window !== 'undefined' && window.cancelIdleCallback
    ? (id: number) => window.cancelIdleCallback(id)
    : (id: number) =>
        window.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

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
  safeWakeup(id: string) {
    const lastWakeup = recentWakeups.get(id);
    if (lastWakeup && Date.now() - lastWakeup < WAKEUP_TTL) {
      return;
    }

    const existing = pendingWakeups.get(id);
    if (existing) {
      return;
    }

    const debounceTimer = setTimeout(() => {
      const pending = pendingWakeups.get(id);
      if (!pending) return;

      const idleTaskId = scheduleIdleTask(async () => {
        try {
          await syncFetch(`/document/${id}/wakeup`, {
            method: 'GET',
          });
          recentWakeups.set(id, Date.now());

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
      });

      pendingWakeups.set(id, { debounceTimer, idleTaskId });
    }, WAKEUP_DEBOUNCE_MS);

    pendingWakeups.set(id, { debounceTimer });
  },
  cancelWakeup(id: string) {
    const pending = pendingWakeups.get(id);
    if (pending) {
      clearTimeout(pending.debounceTimer);
      if (pending.idleTaskId !== undefined) {
        cancelIdleTask(pending.idleTaskId);
      }
      pendingWakeups.delete(id);
    }
  },
  async exists(args: { documentId: string }) {
    const res = await syncFetch(`/document/${args.documentId}/exists`, {
      method: 'HEAD',
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
          ...(isTauri() && { Origin: SYNC_ORIGIN }),
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
          ...(isTauri() && { Origin: SYNC_ORIGIN }),
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

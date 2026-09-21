import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { thrownResultErrorHasCode } from '@core/util/result';
import { emailKeys } from '@queries/email/keys';
import { fetchFreshEmailThread } from '@queries/email/thread';
import type { ApiMessage } from '@service-email/generated/schemas';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import type {
  EmailDraftLifecycleSource,
  EmailDraftLifecycleState,
} from '../context/compose-capabilities';

const EDITING_REFRESH_INTERVAL_MS = 15_000;
const DUE_REFRESH_INTERVAL_MS = 2_000;
const FAR_SCHEDULE_REFRESH_INTERVAL_MS = 30_000;
let nextObserverId = 0;

type DraftLifecycleChange = {
  draftId: string;
  inboxId?: string;
  changedAt: number;
};

const lifecycleBus = createCrossTabBus<DraftLifecycleChange>({
  channelName: 'macro-email-draft-lifecycle',
  storageKey: 'macro:email-draft-lifecycle',
  parse(value) {
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Partial<DraftLifecycleChange>;
    if (
      typeof candidate.draftId !== 'string' ||
      typeof candidate.changedAt !== 'number' ||
      (candidate.inboxId !== undefined && typeof candidate.inboxId !== 'string')
    ) {
      return null;
    }
    return candidate as DraftLifecycleChange;
  },
  getMessageKey: (message) =>
    `${message.draftId}:${message.inboxId ?? ''}:${message.changedAt}`,
});

export function publishDraftLifecycleChange(
  draftId: string,
  inboxId?: string
): void {
  lifecycleBus.publish({ draftId, inboxId, changedAt: Date.now() });
}

export function deriveEmailDraftLifecycle(input: {
  draftId: string;
  threadId: string;
  inboxId?: string;
  message?: ApiMessage;
  observedAt?: number;
}): EmailDraftLifecycleState {
  const observedAt = input.observedAt ?? Date.now();
  const message = input.message;
  if (!message || (input.inboxId && message.link_id !== input.inboxId)) {
    return {
      type: 'missing',
      draftId: input.draftId,
      threadId: input.threadId,
      inboxId: input.inboxId,
      observedAt,
    };
  }
  const identity = {
    draftId: input.draftId,
    threadId: message.thread_db_id,
    inboxId: message.link_id,
    observedAt,
  };
  if (message.is_sent || !message.is_draft) {
    return { type: 'sent', ...identity };
  }
  if (message.scheduled_send_time) {
    return {
      type: 'scheduled',
      ...identity,
      sendTime: message.scheduled_send_time,
    };
  }
  return { type: 'editing', ...identity };
}

async function fetchLifecycle(input: {
  draftId: string;
  threadId: string;
  inboxId?: string;
}): Promise<EmailDraftLifecycleState> {
  const observedAt = Date.now();
  try {
    const thread = await fetchFreshEmailThread(input.threadId, input.draftId);
    return deriveEmailDraftLifecycle({
      ...input,
      observedAt,
      message: thread.messages.find(
        (message) => message.db_id === input.draftId
      ),
    });
  } catch (error) {
    if (thrownResultErrorHasCode(error, 'NOT_FOUND')) {
      return deriveEmailDraftLifecycle({ ...input, observedAt });
    }
    throw error;
  }
}

function refreshInterval(state: EmailDraftLifecycleState | undefined) {
  if (!state || state.type === 'editing') return EDITING_REFRESH_INTERVAL_MS;
  if (state.type !== 'scheduled') return false;
  const untilSend = new Date(state.sendTime).getTime() - Date.now();
  return untilSend > FAR_SCHEDULE_REFRESH_INTERVAL_MS
    ? FAR_SCHEDULE_REFRESH_INTERVAL_MS
    : DUE_REFRESH_INTERVAL_MS;
}

export const emailDraftLifecycleSource: EmailDraftLifecycleSource = {
  observe(input) {
    const queryClient = useQueryClient();
    const observerId = ++nextObserverId;
    // Keep the shared prefix for websocket invalidation, but never share a
    // pending read or cancellation with another composer or a previous mount.
    const observerQueryKey = (
      draftId: string,
      threadId: string,
      inboxId?: string
    ) =>
      [
        ...emailKeys.composeDraftState({ draftId, threadId, inboxId }).queryKey,
        observerId,
      ] as const;
    const [refreshing, setRefreshing] = createSignal<{
      draftId: string;
      threadId: string;
      inboxId?: string;
    }>();
    let refreshVersion = 0;
    const query = useQuery(() => {
      const draftId = input.draftId() ?? '';
      const threadId = input.threadId() ?? '';
      const inboxId = input.inboxId();
      return {
        queryKey: observerQueryKey(draftId, threadId, inboxId),
        enabled: draftId.length > 0 && threadId.length > 0,
        queryFn: () => fetchLifecycle({ draftId, threadId, inboxId }),
        staleTime: 0,
        refetchOnWindowFocus: 'always' as const,
        refetchOnReconnect: 'always' as const,
        refetchInterval: (stateQuery) => refreshInterval(stateQuery.state.data),
      };
    });

    const refresh = async () => {
      const draftId = input.draftId();
      const threadId = input.threadId();
      const inboxId = input.inboxId();
      if (!draftId || !threadId) return undefined;

      const version = ++refreshVersion;
      setRefreshing({ draftId, threadId, inboxId });
      const queryKey = observerQueryKey(draftId, threadId, inboxId);
      try {
        // refetch({ cancelRefetch: true }) still shares an initial pending
        // read. Explicit cancellation prevents its late result from entering
        // this observer's cache; the REST query below starts independently.
        await queryClient.cancelQueries({ queryKey, exact: true });
        const result = await queryClient.fetchQuery({
          queryKey,
          queryFn: () => fetchLifecycle({ draftId, threadId, inboxId }),
          staleTime: 0,
        });
        return version === refreshVersion &&
          draftId === input.draftId() &&
          threadId === input.threadId() &&
          inboxId === input.inboxId()
          ? result
          : undefined;
      } finally {
        if (version === refreshVersion) setRefreshing(undefined);
      }
    };

    const refreshFromEvent = async (event: DraftLifecycleChange) => {
      if (event.draftId !== input.draftId()) return;
      if (event.inboxId && event.inboxId !== input.inboxId()) return;
      try {
        await refresh();
      } catch {
        // Background failures remain query errors and retry on the next event/poll.
      }
    };
    const unsubscribe = lifecycleBus.subscribe(
      (event) => void refreshFromEvent(event)
    );
    onCleanup(unsubscribe);

    // A cached terminal state can predate undo-send or a draft migration.
    // Only a successful read made by this observer can change the composer.
    const state = () => {
      const pending = refreshing();
      if (
        pending?.draftId === input.draftId() &&
        pending?.threadId === input.threadId() &&
        pending?.inboxId === input.inboxId()
      )
        return undefined;
      return query.isSuccess && query.isFetchedAfterMount
        ? query.data
        : undefined;
    };
    return { state, refresh };
  },
};

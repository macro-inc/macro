import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { thrownResultErrorHasCode } from '@core/util/result';
import { emailKeys } from '@queries/email/keys';
import { fetchFreshEmailThread } from '@queries/email/thread';
import type { ApiMessage } from '@service-email/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';
import type {
  EmailDraftLifecycleSource,
  EmailDraftLifecycleState,
} from '../context/compose-capabilities';

const EDITING_REFRESH_INTERVAL_MS = 15_000;
const DUE_REFRESH_INTERVAL_MS = 2_000;
const FAR_SCHEDULE_REFRESH_INTERVAL_MS = 30_000;

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
    const query = useQuery(() => {
      const draftId = input.draftId() ?? '';
      const threadId = input.threadId() ?? '';
      const inboxId = input.inboxId();
      return {
        ...emailKeys.composeDraftState({ draftId, threadId, inboxId }),
        enabled: draftId.length > 0 && threadId.length > 0,
        queryFn: () => fetchLifecycle({ draftId, threadId, inboxId }),
        staleTime: 0,
        refetchOnWindowFocus: 'always' as const,
        refetchOnReconnect: 'always' as const,
        refetchInterval: (stateQuery) => refreshInterval(stateQuery.state.data),
      };
    });

    const unsubscribe = lifecycleBus.subscribe((event) => {
      if (event.draftId !== input.draftId()) return;
      if (event.inboxId && event.inboxId !== input.inboxId()) return;
      void query.refetch();
    });
    onCleanup(unsubscribe);

    const state = () => (query.isSuccess ? query.data : undefined);
    return {
      state,
      async refresh() {
        const result = await query.refetch();
        return result.data;
      },
    };
  },
};

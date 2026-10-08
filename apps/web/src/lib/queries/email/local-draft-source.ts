import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import type {
  FieldFilters,
  QueryState,
} from '@app/features/next-soup/filters/filter-store/types';
import type { EmailEntity } from '@entity';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { authKeys } from '../auth/keys';
import { queryClient } from '../client';
import { listLocalDrafts, localDraftStore } from './local-drafts';

/** Account-scoped local data source; notifications are invalidations, never the truth. */
export function createLocalDraftSource(enabled: Accessor<boolean>) {
  const [drafts, setDrafts] = createSignal<LocalDraft[]>([]);
  const [ready, setReady] = createSignal(false);
  let generation = 0;
  let disposed = false;
  const refresh = async () => {
    const request = ++generation;
    if (!enabled()) {
      setDrafts([]);
      setReady(true);
      return;
    }
    try {
      const entries = await listLocalDrafts();
      if (!disposed && request === generation)
        setDrafts(entries.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch {
      if (!disposed && request === generation) setDrafts([]);
    } finally {
      if (!disposed && request === generation) setReady(true);
    }
  };
  const unsubscribe = localDraftStore.subscribe(() => {
    void refresh();
  });
  const auth = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryHash === JSON.stringify(authKeys.userInfo.queryKey))
      void refresh();
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe();
    auth();
  });
  createEffect(
    on(enabled, () => {
      void refresh();
    })
  );
  return { drafts: () => (enabled() ? drafts() : []), ready };
}

/** One conversation row, even when several local reply drafts share it. */
export function localDraftEntities(
  drafts: readonly LocalDraft[]
): EmailEntity[] {
  const rows = new Map<string, EmailEntity>();
  for (const draft of drafts) {
    if (
      draft.status === 'synced' ||
      (draft.status === 'deleting' &&
        draft.queuedAttemptId &&
        draft.queuedAttemptId === draft.latestAttemptId)
    )
      continue;
    const id = draft.serverThreadId ?? draft.threadId ?? draft.key;
    if (rows.has(id)) continue;
    rows.set(id, {
      type: 'email',
      id,
      name: draft.content.subject || 'Draft email',
      ownerId: draft.accountId,
      isRead: true,
      isDraft: true,
      isImportant: false,
      isSignal: true,
      done: false,
      linkId: draft.inboxId,
      senderEmail: draft.senderEmail,
      participants: (draft.content.to ?? []).map((contact) => ({
        email: contact.email,
        name: contact.name ?? undefined,
      })),
      createdAt: new Date(draft.updatedAt),
      updatedAt: new Date(draft.updatedAt),
      snippet:
        draft.status === 'failed' ||
        draft.status === 'unconfirmed' ||
        draft.status === 'delete-failed'
          ? 'Saved on this device · Not synced'
          : 'Saved on this device',
    });
  }
  return [...rows.values()];
}

/** Server email filters also apply to recovery rows, which never visit that server. */
export function localDraftMatchesFilters(
  draft: LocalDraft,
  query: QueryState
): boolean {
  if (query.emailView === 'sent') return false;
  const matches = (filters: FieldFilters, exclude: boolean) => {
    const fields: [string[] | undefined, (string | undefined)[]][] = [
      [filters.emailLinkId, [draft.inboxId]],
      [filters.threadId, [draft.threadId, draft.serverThreadId]],
      [filters.emailSender, [draft.senderEmail]],
      [filters.emailProjectId, []],
    ];
    for (const [selected, actual] of fields) {
      if (!selected?.length) continue;
      const match = actual.some(
        (value) => value !== undefined && selected.includes(value)
      );
      if (exclude ? match : !match) return false;
    }
    const values: [boolean | undefined, boolean][] = [
      [filters.emailSeen, true],
      [filters.emailDone, false],
      [filters.emailImportance, true],
      [filters.emailCalendarOnly, false],
    ];
    for (const [selected, actual] of values) {
      if (
        selected !== undefined &&
        (exclude ? selected === actual : selected !== actual)
      )
        return false;
    }
    if (filters.emailShared === 'only' && !exclude) return false;
    const range = filters.emailUpdatedAt;
    if (range) {
      const time = draft.updatedAt;
      const match =
        (!range.gt || time > Date.parse(range.gt)) &&
        (!range.gte || time >= Date.parse(range.gte)) &&
        (!range.lt || time < Date.parse(range.lt)) &&
        (!range.lte || time <= Date.parse(range.lte));
      if (exclude ? match : !match) return false;
    }
    return true;
  };
  return matches(query.include, false) && matches(query.exclude, true);
}

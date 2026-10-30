import { t } from '@app/lib/i18n';
import { formatDate } from '@core/util/date';
import { useSessionAutoArchiveQuery } from '@queries/agent-session/auto-archive';
import type { AutoArchiveReason } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { changeSessionArchiveState } from '../queries/change-session-archive-state';

const autoArchiveTitle = (reason: AutoArchiveReason) =>
  match(reason)
    .with('pull_request_merged', () =>
      t('agentAutoArchive.archivedWhenPullRequestsMerged')
    )
    .with('runtime_closed', () =>
      t('agentAutoArchive.archivedWhenSessionClosed')
    )
    .exhaustive();

/** Rendered only while the session is archived. */
export function ArchivedSessionFooter(props: { sessionId: string }) {
  const [pending, setPending] = createSignal(false);
  const autoArchive = useSessionAutoArchiveQuery(() => props.sessionId);
  // A restored session's record stays, but a later archive was made by hand.
  const automatic = () => {
    const archived = autoArchive.isSuccess ? autoArchive.data.archived : null;
    return archived?.restoredAt ? undefined : (archived ?? undefined);
  };

  const unarchive = async () => {
    setPending(true);
    try {
      await changeSessionArchiveState(props.sessionId, false);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="flex items-center justify-between gap-4 rounded-xl border border-edge-muted bg-panel px-4 py-3">
      <div class="min-w-0">
        <Show
          when={automatic()}
          fallback={
            <p class="text-sm font-medium text-ink">
              {t('agentAutoArchive.archived')}
            </p>
          }
        >
          {(archived) => (
            <p class="text-sm font-medium text-ink">
              {autoArchiveTitle(archived().reason)}
              <span class="font-normal text-ink-muted">
                {' · '}
                <time datetime={archived().archivedAt}>
                  {formatDate(archived().archivedAt, { showTime: true })}
                </time>
              </span>
            </p>
          )}
        </Show>
        <p class="text-xs text-ink-muted">
          {t('agentAutoArchive.unarchiveToContinue')}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending()}
        onClick={unarchive}
      >
        {pending()
          ? t('agentAutoArchive.unarchiving')
          : t('entityActions.unarchive')}
      </Button>
    </div>
  );
}

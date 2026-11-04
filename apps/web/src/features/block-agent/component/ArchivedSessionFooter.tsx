import { t } from '@app/lib/i18n';
import { formatDate } from '@core/util/date';
import type { ArchiveCause } from '@service-agent-harness/client';
import type { AgentSessionResponse } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { changeSessionArchiveState } from '../queries/change-session-archive-state';

const archivedTitle = (cause: ArchiveCause | null | undefined) =>
  match(cause)
    .with('pull_request_merged', () =>
      t('agentAutoArchive.archivedWhenPullRequestsMerged')
    )
    .with('runtime_closed', () =>
      t('agentAutoArchive.archivedWhenSessionClosed')
    )
    .with('user', null, undefined, () => t('agentAutoArchive.archived'))
    .exhaustive();

/** Rendered only while the session is archived. */
export function ArchivedSessionFooter(props: {
  session: Pick<AgentSessionResponse, 'id' | 'archivedBy' | 'archivedAt'>;
}) {
  const [pending, setPending] = createSignal(false);

  const unarchive = async () => {
    setPending(true);
    try {
      await changeSessionArchiveState(props.session.id, false);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="flex items-center justify-between gap-4 rounded-xl border border-edge-muted bg-panel px-4 py-3">
      <div class="min-w-0">
        <p class="text-sm font-medium text-ink">
          {archivedTitle(props.session.archivedBy)}
          <Show when={props.session.archivedAt}>
            {(archivedAt) => (
              <span class="font-normal text-ink-muted">
                {' · '}
                <time datetime={archivedAt()}>
                  {formatDate(archivedAt(), { showTime: true })}
                </time>
              </span>
            )}
          </Show>
        </p>
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

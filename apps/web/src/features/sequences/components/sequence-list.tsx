import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import FlowArrowIcon from '@icon/system/regular/tree-structure.svg';
import type { SequenceSummary } from '@service-email/generated/schemas';
import { Badge, EmptyStatePanel } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { SequenceStatusBadge } from './status-badge';

export function SequenceList(props: {
  sequences: readonly SequenceSummary[];
  pending: boolean;
  failed: boolean;
  filtered: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onOpen: (sequenceId: string) => void;
}) {
  return (
    <Switch>
      <Match when={props.pending}>
        <ListSkeleton.Root label={t('sequences.loading')} class="px-4">
          <For each={[1, 2, 3]}>
            {() => (
              <ListSkeleton.Row>
                <ListSkeleton.Bar class="h-4 w-1/2" />
              </ListSkeleton.Row>
            )}
          </For>
        </ListSkeleton.Root>
      </Match>
      <Match when={props.failed}>
        <EmptyStatePanel
          centered
          title={t('sequences.loadFailed')}
          primaryAction={{
            label: t('sequences.retry'),
            onClick: props.onRetry,
          }}
        />
      </Match>
      <Match when={!props.sequences.length}>
        <EmptyStatePanel
          centered
          title={
            props.filtered
              ? t('sequences.noMatchingSequences')
              : t('sequences.noSequences')
          }
          description={
            props.filtered
              ? t('sequences.noMatchingSequencesHint')
              : t('sequences.noSequencesHint')
          }
          primaryAction={
            props.filtered
              ? undefined
              : { label: t('sequences.newSequence'), onClick: props.onCreate }
          }
        />
      </Match>
      <Match when={props.sequences.length}>
        <ul class="flex flex-col px-2 pb-6" aria-label={t('sequences.title')}>
          <For each={props.sequences}>
            {(sequence) => (
              <li>
                <button
                  type="button"
                  class="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none not-touch:hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-accent touch:min-h-[44px]"
                  onClick={() => props.onOpen(sequence.id)}
                >
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-edge-muted text-ink-muted">
                    <FlowArrowIcon class="size-4" aria-hidden="true" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">
                      {sequence.name || t('sequences.untitled')}
                    </span>
                    <span class="block truncate text-xs text-ink-muted">
                      {t('sequences.emailCount', { count: sequence.stepCount })}
                    </span>
                  </span>
                  <Show when={sequence.counts.needsAttention}>
                    {(count) => (
                      <Badge variant="secondary" size="xs" class="text-failure">
                        {t('sequences.needAttentionCount', { count: count() })}
                      </Badge>
                    )}
                  </Show>
                  <span class="hidden shrink-0 text-xs text-ink-muted sm:block">
                    {t('sequences.activeCount', {
                      count: sequence.counts.active,
                    })}
                  </span>
                  <SequenceStatusBadge status={sequence.status} />
                </button>
              </li>
            )}
          </For>
        </ul>
      </Match>
    </Switch>
  );
}

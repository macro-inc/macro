import { ListHeaderSearch } from '@app/components/view-shell/ListHeader';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import FlowArrowIcon from '@icon/system/regular/tree-structure.svg';
import { Badge, EmptyStatePanel } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { failureMessage } from '../components/failure';
import { SectionHeader } from '../components/section-header';
import { SequenceStatusBadge } from '../components/status';
import { useSequences } from '../context/sequences-context';
import { isRetryable } from '../core/errors';
import { blankStep } from '../core/sequence';

const SURFACE = 'sequences.list';

export function SequenceListView(props: {
  navigation?: JSX.Element;
  onOpen: (sequenceId: string) => void;
  onCreated: (sequenceId: string) => void;
}) {
  const context = useSequences();
  const source = context.createSequenceList();
  const senders = context.createSenders();
  const [search, setSearch] = createSignal('');
  const filtered = () => !!search().trim();
  const shown = () => {
    const query = search().trim().toLowerCase();
    return source
      .sequences()
      .filter((sequence) => sequence.name.toLowerCase().includes(query));
  };
  async function create() {
    if (source.creating()) return;
    const result = await source.create({
      name: '',
      footer: '',
      linkId: senders.senders().find((sender) => sender.ready)?.id ?? null,
      steps: [{ ...blankStep(), delayDays: 0, asReply: false }],
    });
    if (result.isErr()) {
      context.feedback.failure(failureMessage(result.error));
      return;
    }
    props.onCreated(result.value.id);
  }
  const openCreate = () => fireAndForget(create(), SURFACE);
  const retry = () => fireAndForget(source.refresh(), SURFACE);
  return (
    <>
      <SectionHeader
        title={
          <div class="flex min-w-0 items-center gap-3">
            {props.navigation}
            <h2 class="truncate text-sm font-semibold">
              {t('sequences.title')}
            </h2>
          </div>
        }
        actions={
          <>
            <ViewCreateButton
              aria-label={t('sequences.newSequence')}
              onClick={openCreate}
            />
            <ListHeaderSearch
              label={t('sequences.search')}
              value={search()}
              onValueChange={setSearch}
              registerFocus={() => {}}
            />
          </>
        }
      />
      <div class="min-h-0 flex-1 overflow-y-auto touch:pb-[var(--mobile-content-inset-bottom,0px)]">
        <Switch>
          <Match when={source.pending()}>
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
          <Match when={source.failure()}>
            {(failure) => (
              <EmptyStatePanel
                centered
                title={t('sequences.loadFailed')}
                description={failureMessage(failure())}
                primaryAction={
                  isRetryable(failure())
                    ? { label: t('sequences.retry'), onClick: retry }
                    : undefined
                }
              />
            )}
          </Match>
          <Match when={!shown().length}>
            <EmptyStatePanel
              centered
              title={
                filtered()
                  ? t('sequences.noMatchingSequences')
                  : t('sequences.noSequences')
              }
              description={
                filtered()
                  ? t('sequences.noMatchingSequencesHint')
                  : t('sequences.noSequencesHint')
              }
              primaryAction={
                filtered()
                  ? undefined
                  : { label: t('sequences.newSequence'), onClick: openCreate }
              }
            />
          </Match>
          <Match when={shown().length}>
            <ul
              class="flex flex-col px-2 pb-6"
              aria-label={t('sequences.title')}
            >
              <For each={shown()}>
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
                          {t('sequences.emailCount', {
                            count: sequence.stepCount,
                          })}
                        </span>
                      </span>
                      <Show when={sequence.counts.needsAttention}>
                        {(count) => (
                          <Badge
                            variant="secondary"
                            size="xs"
                            class="text-failure"
                          >
                            {t('sequences.needAttentionCount', {
                              count: count(),
                            })}
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
      </div>
    </>
  );
}

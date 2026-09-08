import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import ArrowUpRight from '@phosphor-icons/core/regular/arrow-up-right.svg?component-solid';
import GraphIcon from '@phosphor-icons/core/regular/graph.svg?component-solid';
import Search from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import X from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button } from '@ui';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { VList } from 'virtua/solid';
import { ActionGraph } from '../components/action-graph';
import { ActivityNetworkBoard } from '../components/activity-network-board';
import {
  NetworkAvatar,
  NetworkCard,
  NetworkItemIcon,
} from '../components/network-card';
import { TopEntitiesSection, TopEntityChip } from '../components/top-entities';
import {
  type OpenEntityTarget,
  useActivityContext,
} from '../context/activity-context';
import { type NetworkKind, networkKindLabel } from '../core/activity-network';
import { replyStateLabel } from '../core/email-network';
import type { ActivityEvent, ActivityTopEntity } from '../core/event';
import { groupEventsByDay } from '../core/group-events';
import { placeholderOverview } from '../core/placeholder-overview';
import { createActivityNetworkState } from '../primitives/activity-network';
import { createActorName } from '../primitives/actor-name';
import { createEntityOpener } from '../primitives/entity-opener';
import { createMyActivityState } from '../primitives/my-activity';
import { ActivityTimelineRow } from './activity-timeline-row';

const KINDS: NetworkKind[] = ['channel', 'document', 'email-thread', 'project'];
type TimelineEntry =
  | { key: string; label: string }
  | { key: string; event: ActivityEvent };

/** Map accessible recent work and its contributors beside a focused activity timeline. */
export function MyActivityView(props: {
  onOpen: (target: OpenEntityTarget) => void;
}) {
  return (
    <div class="@container/activity flex size-full min-w-0 flex-col">
      <SplitHeaderLeft>
        <span class="font-semibold text-sm">Activity</span>
      </SplitHeaderLeft>
      <Suspense
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-ink-muted">
            Loading activity…
          </div>
        }
      >
        <ActivityWorkspace onOpen={props.onOpen} />
      </Suspense>
    </div>
  );
}

function ActivityWorkspace(props: {
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const state = createMyActivityState(context);
  const feed = () => {
    const value = state.feed();
    return value.t === 'ready' ? value : undefined;
  };
  const ownEvents = createMemo(
    () => feed()?.groups.flatMap((group) => group.events) ?? []
  );
  const network = createActivityNetworkState(context, ownEvents, () => {
    const value = state.overview();
    return value.t === 'ready' ? value.overview.topEntities : [];
  });
  const timeline = createMemo<TimelineEntry[]>(() =>
    groupEventsByDay(network.timeline()).flatMap((group) => [
      { key: group.key, label: group.label },
      ...group.events.map((event) => ({ key: event.id, event })),
    ])
  );
  const selectedItem = () => {
    const selected = network.selection();
    return selected?.kind === 'entity' ? selected.id : undefined;
  };
  const selectedPerson = () => {
    const selected = network.selection();
    return selected?.kind === 'person' ? selected.id : undefined;
  };
  const loading = () => network.loading() || state.feed().t === 'loading';

  return (
    <StaticMarkdownContext>
      <div class="flex flex-wrap items-center gap-3 border-b border-edge-muted px-5 py-4">
        <div class="mr-auto flex items-center gap-3">
          <span class="flex size-9 items-center justify-center rounded-xl border border-edge bg-panel">
            <GraphIcon class="size-[18px] text-accent" />
          </span>
          <div>
            <h1 class="text-sm font-semibold">People & work</h1>
            <p class="mt-0.5 text-[11px] text-ink-muted">
              Who’s involved, and where the conversation stands
            </p>
          </div>
        </div>
        <label class="flex h-8 min-w-40 max-w-60 flex-1 items-center gap-2 rounded-lg border border-edge bg-panel px-2.5 text-ink-muted">
          <Search class="size-3.5 shrink-0" />
          <input
            aria-label="Find people or work"
            placeholder="Find people or work…"
            value={network.search()}
            onInput={(event) => network.setSearch(event.currentTarget.value)}
            class="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-extra-muted"
          />
          <Show when={network.search()}>
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => network.setSearch('')}
            >
              <X class="size-3" />
            </button>
          </Show>
        </label>
        <select
          aria-label="Activity scope"
          value={network.scope()}
          onChange={(event) =>
            network.setScope(
              event.currentTarget.value === 'mine' ? 'mine' : 'workspace'
            )
          }
          class="h-8 rounded-lg border border-edge bg-panel px-2 text-xs outline-accent"
        >
          <option value="workspace">Workspace</option>
          <option value="mine">My activity</option>
        </select>
        <select
          aria-label="Work type"
          value={network.kind()}
          onChange={(event) =>
            network.setKind(
              KINDS.find((kind) => kind === event.currentTarget.value) ?? 'all'
            )
          }
          class="h-8 max-w-36 rounded-lg border border-edge bg-panel px-2 text-xs outline-accent"
        >
          <option value="all">All work</option>
          <For each={KINDS}>
            {(kind) => <option value={kind}>{networkKindLabel(kind)}</option>}
          </For>
        </select>
        <select
          aria-label="Activity time range"
          value={network.period()}
          onChange={(event) =>
            network.setPeriod(
              event.currentTarget.value === '7'
                ? '7'
                : event.currentTarget.value === '30'
                  ? '30'
                  : 'all'
            )
          }
          class="h-8 rounded-lg border border-edge bg-panel px-2 text-xs outline-accent"
        >
          <option value="30">Last 30 days</option>
          <option value="7">Last 7 days</option>
          <option value="all">All loaded activity</option>
        </select>
      </div>
      <div
        class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto @min-[900px]/activity:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] @min-[900px]/activity:overflow-hidden"
        data-activity-layout
      >
        <section
          aria-label="Activity map"
          class="flex min-h-[480px] min-w-0 flex-col @min-[900px]/activity:min-h-0"
        >
          <div class="flex flex-wrap items-center gap-1 border-b border-edge-muted px-4 py-2">
            <For
              each={[
                { id: 'all' as const, label: 'All activity', count: undefined },
                {
                  id: 'unanswered' as const,
                  label: 'No reply yet',
                  count: network.unansweredCount(),
                },
                {
                  id: 'shared' as const,
                  label: 'With teammates',
                  count: network.sharedCount(),
                },
              ]}
            >
              {(filter) => (
                <button
                  type="button"
                  aria-pressed={network.focus() === filter.id}
                  onClick={() => network.setFocus(filter.id)}
                  class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px] text-ink-muted hover:bg-hover"
                  classList={{
                    'bg-accent/10 text-accent!': network.focus() === filter.id,
                  }}
                >
                  {filter.label}
                  <Show when={filter.count !== undefined}>
                    <span class="text-[10px] tabular-nums opacity-70">
                      {filter.count}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <ActivityNetworkBoard
            graph={network.graph()}
            selection={network.selection()}
            loading={loading()}
            resetKey={`${network.scope()}:${network.kind()}:${network.period()}:${network.search()}:${network.focus()}`}
            onSelect={network.select}
            onOpen={(id, newSplit) =>
              network.openItem(id, props.onOpen, newSplit)
            }
            nodeLabel={(node) =>
              network.displays().get(node.id)?.name() ?? 'Work item'
            }
            personLabel={(person) =>
              network.people().get(person.actorId)?.name() || 'Person'
            }
            renderNode={(node) => (
              <NetworkCard
                name={network.displays().get(node.id)?.name() ?? 'Work item'}
                kind={node.entityType}
                block={network.displays().get(node.id)?.blockOrFileType()}
                count={node.events.length}
                date={node.events[0].occurredAt}
                selected={selectedItem() === node.id}
                replyState={node.replyState}
              />
            )}
            renderPerson={(person) => (
              <NetworkAvatar
                name={network.people().get(person.actorId)?.name() || 'Person'}
                picture={network.people().get(person.actorId)?.picture()}
                isYou={network.people().get(person.actorId)?.isYou}
                selected={selectedPerson() === person.actorId}
                subtitle={
                  person.connectedCount
                    ? `${person.connectedCount} connected ${person.connectedCount === 1 ? 'item' : 'items'}`
                    : 'No recent work in this view'
                }
              />
            )}
          />
        </section>
        <aside
          aria-label="Activity timeline"
          class="flex h-[600px] min-h-0 min-w-0 flex-col border-t border-edge-muted bg-surface @min-[900px]/activity:h-auto @min-[900px]/activity:border-l @min-[900px]/activity:border-t-0"
        >
          <div class="border-b border-edge-muted px-4 py-4">
            <div class="flex items-center justify-between gap-2">
              <h2 class="truncate text-sm font-semibold">
                {network.selection()
                  ? network.selectionName()
                  : 'Recent activity'}
              </h2>
              <Show
                when={network.selection()}
                fallback={
                  <span class="rounded-md bg-panel px-1.5 py-0.5 text-[10px] tabular-nums text-ink-muted">
                    {network.timeline().length}
                  </span>
                }
              >
                <button
                  type="button"
                  aria-label="Clear graph selection"
                  class="rounded-md p-1 text-ink-muted hover:bg-hover"
                  onClick={() => network.select(undefined)}
                >
                  <X class="size-3.5" />
                </button>
              </Show>
            </div>
            <p class="mt-1 text-[11px] text-ink-muted">
              {network.selection()
                ? `${network.timeline().length} ${selectedPerson() ? 'actions on connected work' : 'recorded actions'}`
                : network.scope() === 'mine'
                  ? 'Your latest actions, in context'
                  : 'Recent work you have access to'}
            </p>
            <Show when={network.selectedEmail()}>
              {(email) => (
                <div class="mt-3 space-y-3">
                  <div class="rounded-lg border border-edge-muted bg-panel px-3 py-2.5">
                    <p
                      class="text-xs font-medium"
                      classList={{
                        'text-warning': email().replyState === 'unanswered',
                        'text-success':
                          email().replyState === 'replied' ||
                          email().replyState === 'team-replied',
                      }}
                    >
                      {replyStateLabel(email().replyState)}
                    </p>
                    <Show
                      when={
                        email().replyBy && email().replyState === 'team-replied'
                      }
                    >
                      <p class="mt-1 text-[11px] text-ink-muted">
                        Reply from{' '}
                        {network.people().get(email().replyBy!.id)?.name() ||
                          email().replyBy!.name}
                      </p>
                    </Show>
                    <Show when={email().latestFrom}>
                      <p class="mt-1 truncate text-[11px] text-ink-muted">
                        Last message from {email().latestFrom}
                      </p>
                    </Show>
                    <Show when={email().latestAt}>
                      <p class="mt-1 text-[10px] text-ink-extra-muted">
                        {new Date(email().latestAt!).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </Show>
                  </div>
                  <div>
                    <h3 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-extra-muted">
                      Others on this email
                    </h3>
                    <div class="flex max-h-36 flex-wrap gap-1.5 overflow-auto">
                      <For each={email().people}>
                        {(person) => (
                          <button
                            type="button"
                            title={person.email}
                            aria-label={`Explore ${network.people().get(person.id)?.name() ?? person.email}`}
                            onClick={() =>
                              network.select({ kind: 'person', id: person.id })
                            }
                            class="flex max-w-full items-center gap-1.5 rounded-full border border-edge-muted bg-panel py-1 pl-1 pr-2.5 text-[11px] hover:border-ink-muted"
                          >
                            <span class="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 text-[9px]">
                              <Show
                                when={network
                                  .people()
                                  .get(person.id)
                                  ?.picture()}
                                fallback={(
                                  network.people().get(person.id)?.name() ||
                                  person.email
                                )
                                  .slice(0, 1)
                                  .toUpperCase()}
                              >
                                {(url) => (
                                  <img
                                    class="size-full object-cover"
                                    src={url()}
                                    alt=""
                                  />
                                )}
                              </Show>
                            </span>
                            <span class="truncate">
                              {network.people().get(person.id)?.name() ||
                                person.email}
                            </span>
                            <span class="shrink-0 text-[9px] text-ink-extra-muted">
                              {person.role}
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              )}
            </Show>
            <Show when={selectedPerson() && network.selectedWork().length}>
              <div class="mt-3">
                <h3 class="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-extra-muted">
                  Connected work
                </h3>
                <div class="max-h-56 space-y-1.5 overflow-y-auto">
                  <For each={network.selectedWork()}>
                    {(item) => (
                      <button
                        type="button"
                        onClick={() =>
                          network.select({ kind: 'entity', id: item.id })
                        }
                        class="flex w-full items-center gap-2 rounded-lg border border-edge-muted bg-panel p-2 text-left text-ink-muted hover:border-ink-muted"
                      >
                        <NetworkItemIcon
                          kind={item.entityType}
                          task={
                            network
                              .displays()
                              .get(item.id)
                              ?.blockOrFileType() === 'task'
                          }
                        />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs text-ink">
                            {network.displays().get(item.id)?.name() ??
                              'Work item'}
                          </span>
                          <span
                            class="mt-1 block text-[10px]"
                            classList={{
                              'text-warning': item.replyState === 'unanswered',
                              'text-success':
                                item.replyState === 'replied' ||
                                item.replyState === 'team-replied',
                            }}
                          >
                            {item.replyState && item.replyState !== 'unknown'
                              ? replyStateLabel(item.replyState)
                              : `${item.actors.length} people · ${item.events.length} actions`}
                          </span>
                        </span>
                        <ArrowUpRight class="size-3 shrink-0" />
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
            <Show when={selectedItem()}>
              {(id) => (
                <button
                  type="button"
                  onClick={(event) =>
                    network.openItem(id(), props.onOpen, event.shiftKey)
                  }
                  class="mt-3 flex items-center gap-1.5 text-xs font-medium text-accent"
                >
                  {network.selectedEmail() ? 'Open email' : 'Open item'}{' '}
                  <ArrowUpRight class="size-3.5" />
                </button>
              )}
            </Show>
          </div>
          <Show when={network.error()}>
            <div class="border-b border-edge-muted px-4 py-3 text-xs text-ink-muted">
              Some shared activity could not load. The map may be incomplete.{' '}
              <button type="button" class="text-accent" onClick={network.retry}>
                Retry
              </button>
            </div>
          </Show>
          <Show when={network.detailsError()}>
            <div class="border-b border-edge-muted px-4 py-3 text-xs text-ink-muted">
              Email participants and reply status could not load.{' '}
              <button type="button" class="text-accent" onClick={network.retry}>
                Retry
              </button>
            </div>
          </Show>
          <Show
            when={timeline().length > 0}
            fallback={
              <div
                class="p-5 text-xs leading-relaxed text-ink-muted"
                role="status"
              >
                {loading()
                  ? 'Loading…'
                  : state.feed().t === 'error' && !network.timeline().length
                    ? 'Activity is unavailable right now. Try again in a moment.'
                    : network.selection()?.kind === 'person'
                      ? 'No recent activity loaded for this person.'
                      : network.search() ||
                          network.kind() !== 'all' ||
                          network.focus() !== 'all'
                        ? 'No activity matches these filters.'
                        : 'No activity yet.'}
              </div>
            }
          >
            <div class="min-h-0 flex-1" data-activity-timeline-scroll>
              <VList
                data={timeline()}
                style={{ height: '100%' }}
                bufferSize={240}
              >
                {(entry) => (
                  <Show
                    when={'event' in entry ? entry.event : undefined}
                    fallback={
                      <div class="px-4 pb-1 pt-4 text-[10px] font-medium uppercase tracking-wider text-ink-extra-muted">
                        {'label' in entry ? entry.label : ''}
                      </div>
                    }
                  >
                    {(event) => (
                      <NamedActivityRow event={event()} onOpen={props.onOpen} />
                    )}
                  </Show>
                )}
              </VList>
            </div>
          </Show>
          <Show when={feed()?.hasMore}>
            <div class="flex justify-center border-t border-edge-muted py-1">
              <Button
                variant="ghost"
                onClick={state.loadMore}
                disabled={feed()?.loadingMore}
              >
                {feed()?.loadingMore ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          </Show>
          <details
            class="shrink-0 border-t border-edge-muted"
            data-activity-overview
          >
            <summary class="px-4 py-3 text-xs font-medium text-ink-muted hover:bg-hover">
              Your activity overview
            </summary>
            <div class="max-h-80 overflow-auto p-2">
              <ActivityOverviewContent state={state} onOpen={props.onOpen} />
            </div>
          </details>
        </aside>
      </div>
    </StaticMarkdownContext>
  );
}

function ActivityOverviewContent(props: {
  state: ReturnType<typeof createMyActivityState>;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const overview = () => {
    const value = props.state.overview();
    return value.t === 'ready' ? value.overview : undefined;
  };
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <Show
        when={overview()}
        fallback={
          <Show
            when={props.state.overview().t === 'error'}
            fallback={
              <ActionGraph
                overview={placeholderOverview(new Date())}
                skeleton
              />
            }
          >
            <p class="px-2 text-xs text-ink-muted">
              Activity overview is unavailable right now.
            </p>
          </Show>
        }
      >
        {(overview) => (
          <>
            <ActionGraph overview={overview()} />
            <Show when={overview().topEntities.length > 0}>
              <TopEntitiesSection>
                <For each={overview().topEntities}>
                  {(entity) => (
                    <OpenableTopEntityChip
                      entity={entity}
                      onOpen={props.onOpen}
                    />
                  )}
                </For>
              </TopEntitiesSection>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function NamedActivityRow(props: {
  event: ActivityEvent;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const name = createActorName(context, () => props.event.actorId);
  return (
    <ActivityTimelineRow
      event={props.event}
      actorName={name()}
      compact
      onOpen={props.onOpen}
    />
  );
}

function OpenableTopEntityChip(props: {
  entity: ActivityTopEntity;
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const opener = createEntityOpener(
    context,
    () => props.entity.entityId,
    () => props.entity.entityType,
    props.onOpen
  );
  return (
    <TopEntityChip
      entity={props.entity}
      display={opener()?.display}
      rowProps={opener()?.handlers}
    />
  );
}

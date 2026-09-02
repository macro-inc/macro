import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Button } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { ActionGraph } from '../components/action-graph';
import { TopEntitiesSection, TopEntityRow } from '../components/top-entities';
import type { ActivityEvent, ActivityTopEntity } from '../core/event';
import { useActivityDeps } from '../deps';
import { createActorName } from '../state/actor-name';
import { createEntityOpener } from '../state/entity-opener';
import { createMyActivityState } from '../state/my-activity';
import { ActivityTimelineRow } from './activity-timeline-row';

function OverviewInset(props: { children: JSX.Element }) {
  return (
    <div class="mx-1 flex w-[calc(100%-0.5rem)] min-w-0 flex-col gap-2 pb-2">
      {props.children}
    </div>
  );
}

function FeedStatus(props: { children: JSX.Element }) {
  return (
    <p class="mx-1 w-[calc(100%-0.5rem)] px-2 py-2 text-ink-muted text-sm">
      {props.children}
    </p>
  );
}

/** The user's own activity, newest first. Needs `ActivityDeps` in context. */
export function MyActivityView() {
  const deps = useActivityDeps();
  const state = createMyActivityState(deps);
  const overview = () => {
    const current = state.overview();
    return current.t === 'ready' ? current.overview : undefined;
  };
  const feed = () => {
    const current = state.feed();
    return current.t === 'ready' ? current : undefined;
  };

  return (
    <div class="@container/u-list flex size-full flex-col">
      <SplitHeaderLeft>
        <span class="font-semibold text-sm">Activity</span>
      </SplitHeaderLeft>
      <StaticMarkdownContext>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          <div class="mx-auto w-full max-w-[1000px]">
            <Show
              when={overview()}
              fallback={
                <OverviewInset>
                  <p class="px-2 py-1 text-ink-extra-muted text-xs">
                    {state.overview().t === 'error'
                      ? 'Activity overview is unavailable right now.'
                      : 'Loading activity overview…'}
                  </p>
                </OverviewInset>
              }
            >
              {(overview) => (
                <>
                  <OverviewInset>
                    <ActionGraph overview={overview()} />
                  </OverviewInset>
                  <TopEntitiesSection
                    empty={overview().topEntities.length === 0}
                  >
                    <For each={overview().topEntities}>
                      {(entity) => <OpenableTopEntityRow entity={entity} />}
                    </For>
                  </TopEntitiesSection>
                </>
              )}
            </Show>
            <Switch>
              <Match when={feed()}>
                {(feed) => (
                  <>
                    <For each={feed().groups}>
                      {(group) => (
                        <>
                          <SoupSectionHeader>{group.label}</SoupSectionHeader>
                          <For each={group.events}>
                            {(event) => <NamedActivityRow event={event} />}
                          </For>
                        </>
                      )}
                    </For>
                    <Show when={feed().hasMore}>
                      <div class="flex justify-center py-2">
                        <Button
                          variant="ghost"
                          onClick={state.loadMore}
                          disabled={feed().loadingMore}
                        >
                          {feed().loadingMore ? 'Loading…' : 'Show more'}
                        </Button>
                      </div>
                    </Show>
                  </>
                )}
              </Match>
              <Match when={state.feed().t === 'loading'}>
                <FeedStatus>Loading…</FeedStatus>
              </Match>
              <Match when={state.feed().t === 'error'}>
                <FeedStatus>
                  Activity is unavailable right now. Try again in a moment.
                </FeedStatus>
              </Match>
              <Match when={state.feed().t === 'empty'}>
                <FeedStatus>No activity yet.</FeedStatus>
              </Match>
            </Switch>
          </div>
        </div>
      </StaticMarkdownContext>
    </div>
  );
}

function NamedActivityRow(props: { event: ActivityEvent }) {
  const deps = useActivityDeps();
  const name = createActorName(deps, () => props.event.actorId);
  return <ActivityTimelineRow event={props.event} actorName={name()} />;
}

function OpenableTopEntityRow(props: { entity: ActivityTopEntity }) {
  const deps = useActivityDeps();
  const opener = createEntityOpener(
    deps,
    () => props.entity.entityId,
    () => props.entity.entityType
  );
  return (
    <TopEntityRow
      entity={props.entity}
      display={opener()?.display}
      rowProps={opener()?.handlers}
    />
  );
}

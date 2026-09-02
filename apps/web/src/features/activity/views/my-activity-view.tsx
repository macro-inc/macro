import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Button } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { ActionGraph } from '../components/action-graph';
import type { ActivityEvent } from '../core/event';
import type { FeedGroup } from '../core/group-events';
import { useActivityDeps } from '../deps';
import { createActorName } from '../state/actor-name';
import { createMyActivityState, type OverviewView } from '../state/my-activity';
import { ActivityTimelineRow } from './activity-timeline-row';
import { TopEntities } from './top-entities';

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

/** The user's own activity, newest first. Mount under `ActivityDepsProvider`. */
export function MyActivityView() {
  const deps = useActivityDeps();
  const state = createMyActivityState(deps);
  const ready = () => {
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
            <OverviewInset>
              <Switch>
                <Match when={state.overview().t === 'loading'}>
                  <p class="px-2 py-1 text-ink-extra-muted text-xs">
                    Loading activity overview…
                  </p>
                </Match>
                <Match when={state.overview().t === 'error'}>
                  <p class="px-2 py-1 text-ink-extra-muted text-xs">
                    Activity overview is unavailable right now.
                  </p>
                </Match>
                <Match when={readyOverview(state.overview())}>
                  {(overview) => <ActionGraph overview={overview()} />}
                </Match>
              </Switch>
            </OverviewInset>
            <Show when={readyOverview(state.overview())}>
              {(overview) => <TopEntities entities={overview().topEntities} />}
            </Show>
            <Switch>
              <Match when={ready()}>
                {(feed) => (
                  <>
                    <FeedGroups groups={feed().groups} />
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

function readyOverview(view: OverviewView) {
  return view.t === 'ready' ? view.overview : undefined;
}

function NamedActivityRow(props: { event: ActivityEvent }) {
  const deps = useActivityDeps();
  const name = createActorName(deps, () => props.event.actorId);
  return <ActivityTimelineRow event={props.event} actorName={name()} />;
}

function FeedGroups(props: { groups: FeedGroup[] }) {
  return (
    <For each={props.groups}>
      {(group) => (
        <>
          <SoupSectionHeader>{group.label}</SoupSectionHeader>
          <For each={group.events}>
            {(event) => <NamedActivityRow event={event} />}
          </For>
        </>
      )}
    </For>
  );
}

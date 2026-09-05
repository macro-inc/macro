import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Button } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { ActionGraph } from '../components/action-graph';
import { TopEntitiesSection, TopEntityRow } from '../components/top-entities';
import {
  type OpenEntityTarget,
  useActivityContext,
} from '../context/activity-context';
import type { ActivityEvent, ActivityTopEntity } from '../core/event';
import { createActorName } from '../primitives/actor-name';
import { createEntityOpener } from '../primitives/entity-opener';
import { createMyActivityState } from '../primitives/my-activity';
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

/**
 * The user's own activity, newest first. Reads `ActivityContext`;
 * the host decides what a row click opens.
 */
export function MyActivityView(props: {
  onOpen: (target: OpenEntityTarget) => void;
}) {
  const context = useActivityContext();
  const state = createMyActivityState(context);
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
                      {(entity) => (
                        <OpenableTopEntityRow
                          entity={entity}
                          onOpen={props.onOpen}
                        />
                      )}
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
                            {(event) => (
                              <NamedActivityRow
                                event={event}
                                onOpen={props.onOpen}
                              />
                            )}
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
      onOpen={props.onOpen}
    />
  );
}

function OpenableTopEntityRow(props: {
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
    <TopEntityRow
      entity={props.entity}
      display={opener()?.display}
      rowProps={opener()?.handlers}
    />
  );
}

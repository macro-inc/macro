import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { TabsInset } from '@core/component/TabsInset';
import { useUserId } from '@core/context/user';
import {
  Entity,
  type EntityData,
  isAutomationEntity,
  isCallEntity,
  isChannelEntity,
  isChannelMessageEntity,
  isEmailEntity,
  isProjectContainedEntity,
  isTaskEntity,
} from '@entity';
import { ProjectBreadCrumb } from '@entity/components/ProjectBreadCrumb';
import { AutomationWideContent } from '@entity/composed/list-entity/automation';
import { CallWideContent } from '@entity/composed/list-entity/call';
import {
  ChannelMessageWideContent,
  ChannelWideContent,
} from '@entity/composed/list-entity/channel';
import { EmailWideContent } from '@entity/composed/list-entity/email';
import { useSoupItemsQuery } from '@queries/soup/items';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { Layer } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';

function entityTimestamp(entity: EntityData, mode: 'recent' | 'shared') {
  return mode === 'recent'
    ? entity.viewedAt || entity.updatedAt || entity.createdAt
    : entity.updatedAt || entity.createdAt || entity.viewedAt;
}

function EntityRow(props: { entity: EntityData; mode: 'recent' | 'shared' }) {
  const open = (event: MouseEvent) => {
    void openEntityInSplitFromUnifiedList(props.entity, {
      openInNewSplit: event.shiftKey,
    });
  };

  return (
    <button
      class="group relative grid min-h-10 w-full grid-cols-[1fr_auto] items-center rounded-lg py-0.5 pr-1 text-left transition hover:bg-active/30 focus:outline-none focus-visible:bg-active/30"
      onClick={open}
    >
      <div class="grid min-w-0 grid-cols-[1rem_1fr_auto] items-center gap-2 px-2 text-sm [--title-width:10rem]">
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} />
        </div>

        <div class="flex min-w-0 items-center gap-2 truncate font-semibold">
          <Switch fallback={<Entity.Title entity={props.entity} />}>
            <Match when={isEmailEntity(props.entity) && props.entity}>
              {(entity) => (
                <EmailWideContent
                  entity={entity()}
                  chars={120}
                  showHitSnippet={false}
                  setContainerRef={() => {}}
                />
              )}
            </Match>
            <Match when={isChannelMessageEntity(props.entity) && props.entity}>
              {(entity) => <ChannelMessageWideContent entity={entity()} />}
            </Match>
            <Match when={isChannelEntity(props.entity) && props.entity}>
              {(entity) => (
                <ChannelWideContent entity={entity()} showLatestMessage />
              )}
            </Match>
            <Match when={isCallEntity(props.entity) && props.entity}>
              {(entity) => (
                <CallWideContent
                  entity={entity()}
                  chars={120}
                  setContainerRef={() => {}}
                />
              )}
            </Match>
            <Match when={isAutomationEntity(props.entity) && props.entity}>
              {(entity) => <AutomationWideContent entity={entity()} />}
            </Match>
          </Switch>
        </div>

        <div class="flex items-center gap-2">
          <Show when={isProjectContainedEntity(props.entity) && props.entity}>
            {(entity) => (
              <span class="text-xs text-ink-extra-muted">
                <ProjectBreadCrumb entity={entity()} />
              </span>
            )}
          </Show>
          <Show when={isTaskEntity(props.entity) && props.entity}>
            {(entity) => <Entity.Properties entity={entity()} />}
          </Show>
          <span class="shrink-0 text-xs font-light text-ink-extra-muted">
            <Entity.Timestamp
              entity={props.entity}
              overrideTimeStamp={entityTimestamp(props.entity, props.mode)}
            />
          </span>
        </div>
      </div>

      <div class="pointer-events-none opacity-0 transition group-hover:opacity-100">
        <Layer depth={3}>
          <div class="flex size-8 items-center justify-center rounded-xl bg-hover text-ink-muted transition group-hover:text-ink">
            <ArrowRightIcon class="size-4" />
          </div>
        </Layer>
      </div>
    </button>
  );
}

export function RecentSharedSection() {
  const userId = useUserId();
  const [tab, setTab] = createSignal<'recent' | 'shared'>('recent');
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  const recentQuery = useSoupItemsQuery(() => ({
    params: { sort_method: 'viewed_at', limit: 30 },
    body: {
      call_filters: {
        call_ids: ['00000000-0000-0000-0000-000000000000'],
      },
    },
  }));

  const sharedQuery = useSoupItemsQuery(() => ({
    params: { sort_method: 'updated_at', limit: 30 },
    body: {
      call_filters: {
        call_ids: ['00000000-0000-0000-0000-000000000000'],
      },
    },
  }));

  const recentItems = createMemo(() => (recentQuery.data ?? []).slice(0, 20));
  const sharedItems = createMemo(() =>
    (sharedQuery.data ?? [])
      .filter((entity) => !!userId() && entity.ownerId !== userId())
      .slice(0, 6)
  );

  const items = createMemo(() =>
    tab() === 'recent' ? recentItems() : sharedItems()
  );
  const isLoading = createMemo(() =>
    tab() === 'recent' ? recentQuery.isLoading : sharedQuery.isLoading
  );

  return (
    <section>
      <Layer depth={2}>
        <div class="overflow-hidden rounded-2xl border border-edge-muted bg-surface">
          <div class="p-3">
            <TabsInset
              value={tab()}
              onChange={(value) => setTab(value as 'recent' | 'shared')}
              depth={3}
              class="inline-flex h-auto"
              list={[
                { value: 'recent', label: 'Recent' },
                { value: 'shared', label: 'Shared' },
              ]}
            />
          </div>

          <div class="relative">
            <div
              ref={setScrollContainer}
              class="max-h-80 overflow-y-auto px-3 pb-3"
            >
              <Switch>
                <Match when={isLoading()}>
                  <div class="space-y-1">
                    <For each={[0, 1, 2, 3]}>
                      {() => (
                        <div class="flex h-14 items-center gap-3 rounded-lg p-2.5">
                          <div class="size-8 rounded-lg bg-hover" />
                          <div class="min-w-0 flex-1 space-y-2">
                            <div class="h-2.5 w-3/5 rounded-full bg-ink/10" />
                            <div class="h-2 w-2/5 rounded-full bg-ink/5" />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Match>
                <Match when={items().length === 0}>
                  <div class="flex flex-col items-center justify-center rounded-xl bg-hover/50 px-4 py-6 text-center">
                    <p class="text-sm font-medium text-ink">
                      No {tab() === 'recent' ? 'recent' : 'shared'} items
                    </p>
                    <p class="mt-1 text-xs text-ink-muted">
                      {tab() === 'recent'
                        ? 'Recently opened files will appear here.'
                        : 'Items shared with you will appear here.'}
                    </p>
                  </div>
                </Match>
                <Match when={true}>
                  <div class="space-y-1">
                    <For each={items()}>
                      {(entity) => <EntityRow entity={entity} mode={tab()} />}
                    </For>
                  </div>
                </Match>
              </Switch>
            </div>
            <CustomScrollbar
              scrollContainer={scrollContainer}
              labelVisibilityDebounceMs={Infinity}
              class="right-0.5"
            />
          </div>
        </div>
      </Layer>
    </section>
  );
}

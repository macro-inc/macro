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
import { useSoupItemsQuery } from '@queries/soup/items';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { Layer } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';

function entityTimestamp(entity: EntityData, mode: 'recent' | 'shared') {
  return mode === 'recent'
    ? entity.viewedAt || entity.updatedAt || entity.createdAt
    : entity.updatedAt || entity.createdAt || entity.viewedAt;
}

function EntityPrimary(props: { entity: EntityData }) {
  return (
    <Switch fallback={<Entity.Title entity={props.entity} />}>
      <Match when={isEmailEntity(props.entity) && props.entity}>
        {(entity) => <Entity.Title entity={entity()} />}
      </Match>
      <Match when={isChannelMessageEntity(props.entity) && props.entity}>
        {(entity) => <span class="truncate">{entity().channelName}</span>}
      </Match>
      <Match when={isChannelEntity(props.entity) && props.entity}>
        {(entity) => <Entity.Title entity={entity()} />}
      </Match>
      <Match when={isCallEntity(props.entity) && props.entity}>
        {(entity) => <Entity.Title entity={entity()} />}
      </Match>
      <Match when={isAutomationEntity(props.entity) && props.entity}>
        {(entity) => <Entity.Title entity={entity()} />}
      </Match>
    </Switch>
  );
}

function EntityInlineMeta(props: { entity: EntityData }) {
  return (
    <Switch>
      <Match when={isTaskEntity(props.entity) && props.entity}>
        {(entity) => <Entity.Properties entity={entity()} />}
      </Match>
      <Match when={isProjectContainedEntity(props.entity) && props.entity}>
        {(entity) => <ProjectBreadCrumb entity={entity() as any} />}
      </Match>
      <Match when={isEmailEntity(props.entity) && props.entity}>
        {(entity) => <Entity.EmailParticipants entity={entity()} />}
      </Match>
      <Match when={isAutomationEntity(props.entity) && props.entity}>
        {(entity) => (
          <Show
            when={entity().isRunning}
            fallback={entity().enabled ? 'Active' : 'Paused'}
          >
            Running
          </Show>
        )}
      </Match>
      <Match when={isCallEntity(props.entity) && props.entity}>
        {(entity) => entity().channelName || 'Call'}
      </Match>
    </Switch>
  );
}

function EntityRow(props: { entity: EntityData; mode: 'recent' | 'shared' }) {
  const open = (event: MouseEvent) => {
    void openEntityInSplitFromUnifiedList(props.entity, {
      openInNewSplit: event.shiftKey,
    });
  };

  return (
    <button
      class="group relative flex min-h-10 w-full items-center rounded-lg py-1 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={open}
    >
      <div class="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm">
        <div class="size-4 shrink-0">
          <Entity.Icon entity={props.entity} />
        </div>

        <div class="min-w-0 flex-1 truncate font-semibold">
          <EntityPrimary entity={props.entity} />
        </div>

        <div class="hidden min-w-0 shrink items-center gap-2 overflow-hidden text-xs text-ink-muted @2xl/dashboard:flex">
          <EntityInlineMeta entity={props.entity} />
        </div>

        <span class="shrink-0 text-xs font-light text-ink-extra-muted">
          <Entity.Timestamp
            entity={props.entity}
            overrideTimeStamp={entityTimestamp(props.entity, props.mode)}
          />
        </span>
      </div>

      <div class="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition group-hover:opacity-100">
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
  const [tab, setTab] = createSignal<'relevant' | 'shared'>('relevant');
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();

  const relevantQuery = useSoupItemsQuery(() => ({
    params: { sort_method: 'frecency', limit: 30 },
    body: {
      call_filters: {
        call_ids: ['00000000-0000-0000-0000-000000000000'],
      },
      chat_filters: {
        owners: [userId()],
      },
      document_filters: {
        owners: [userId()],
      },
      project_filters: {
        owners: [userId()],
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

  const relevantItems = createMemo(() => (relevantQuery.data ?? []).slice(0, 20));
  const sharedItems = createMemo(() =>
    (sharedQuery.data ?? [])
      .filter((entity) => !!userId() && entity.ownerId !== userId())
      .slice(0, 6)
  );

  const items = createMemo(() =>
    tab() === 'relevant' ? relevantItems() : sharedItems()
  );
  const isLoading = createMemo(() =>
    tab() === 'relevant' ? relevantQuery.isLoading : sharedQuery.isLoading
  );

  return (
    <section>
      <Layer depth={2}>
        <div class="overflow-hidden rounded-2xl border border-edge-muted bg-surface">
          <div class="p-3">
            <TabsInset
              value={tab()}
              onChange={(value) => setTab(value as 'relevant' | 'shared')}
              depth={3}
              class="inline-flex h-auto"
              list={[
                { value: 'relevant', label: 'Relevant' },
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
                          <div class="skeleton-shimmer size-8 rounded-lg bg-hover" />
                          <div class="min-w-0 flex-1 space-y-2">
                            <div class="skeleton-shimmer h-2.5 w-3/5 rounded-full bg-ink/10" />
                            <div class="skeleton-shimmer h-2 w-2/5 rounded-full bg-ink/5" />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Match>
                <Match when={items().length === 0}>
                  <div class="flex flex-col items-center justify-center rounded-xl bg-hover/50 px-4 py-6 text-center">
                    <p class="text-sm font-medium text-ink">
                      No {tab() === 'relevant' ? 'relevant' : 'shared'} items
                    </p>
                    <p class="mt-1 text-xs text-ink-muted">
                      {tab() === 'relevant'
                        ? 'Relevant items will appear here.'
                        : 'Items shared with you will appear here.'}
                    </p>
                  </div>
                </Match>
                <Match when={true}>
                  <div class="space-y-1">
                    <For each={items()}>
                      {(entity) => (
                        <EntityRow
                          entity={entity}
                          mode={tab() === 'relevant' ? 'recent' : 'shared'}
                        />
                      )}
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

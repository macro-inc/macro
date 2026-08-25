import { activeAppLayoutSurfaces } from '@app/features/app-layout/layout-surfaces';
import { dateBucket } from '@app/features/next-soup/soup-view/group-by-date';
import { SoupSectionHeader } from '@app/features/next-soup/soup-view/section-header';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { formatRelativeTimestamp } from '@entity/utils/timestamp';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { ActivityEvent } from '@queries/activity/graphql/entity';
import { createMyActivityQuery } from '@queries/activity/graphql/feed';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { GraphqlEntityType } from '@service-storage/graphql/generated/graphql';
import { Button, cn } from '@ui';
import { type Component, createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { ActionGlyph } from './action-glyph';
import { ActionPhrase } from './action-phrase';
import { ActorName } from './actor-name';
import {
  actionAsPropertyChange,
  describeActionForEntity,
} from './describe-action';
import { EntityMention } from './entity-mention';
import { PropertyChangeText } from './property-change';

/**
 * Maps an activity event's canonical entity type onto the display vocabulary
 * used by the shared entity name/icon/link resolver. Only types the resolver
 * can actually name are mapped — calls, calendar events, and companies have
 * no preview/name source there and would render as a stuck "Loading…" or a
 * raw id, so they (like teams and static files) return undefined and the row
 * shows without an entity reference.
 */
export function displayEntityType(
  entityType: GraphqlEntityType
): EntityType | undefined {
  return match<GraphqlEntityType, EntityType | undefined>(entityType)
    .with('DOCUMENT', () => 'DOCUMENT')
    .with('PROJECT', () => 'PROJECT')
    .with('CHAT', () => 'CHAT')
    .with('EMAIL_THREAD', () => 'THREAD')
    .with('CHANNEL', () => 'CHANNEL')
    .with('USER', () => 'USER')
    .otherwise(() => undefined);
}

type FeedGroup = { key: string; label: string; events: ActivityEvent[] };

/** The user's own activity, newest first, behind the activity-feed flag. */
export function MyActivityView() {
  const feed = createMyActivityQuery({ enabled: () => true });
  const groups = createMemo<FeedGroup[]>(() => {
    const out: FeedGroup[] = [];
    for (const event of feed.data ?? []) {
      const bucket = dateBucket(event.occurredAt);
      const last = out[out.length - 1];
      if (last?.key === bucket.key) {
        last.events.push(event);
      } else {
        out.push({ ...bucket, events: [event] });
      }
    }
    return out;
  });

  const FeedContent = (contentProps: { experimental?: boolean }) => (
    <StaticMarkdownContext>
      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <Show
          when={groups().length > 0}
          fallback={
            <p
              class={cn(
                'py-2 text-sm text-ink-muted',
                contentProps.experimental ? 'px-2' : 'px-3'
              )}
            >
              {feed.isLoading
                ? 'Loading…'
                : feed.isError
                  ? 'Activity is unavailable right now. Try again in a moment.'
                  : 'No activity yet.'}
            </p>
          }
        >
          <FeedGroups
            groups={groups()}
            row={SentenceTimelineRow}
            experimental={contentProps.experimental}
          />
          <Show when={feed.hasNextPage}>
            <div class="flex justify-center py-2">
              <Button
                variant="ghost"
                class={contentProps.experimental ? 'rounded-full' : undefined}
                onClick={() => void feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
              >
                {feed.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          </Show>
        </Show>
      </div>
    </StaticMarkdownContext>
  );

  return (
    <Show
      when={activeAppLayoutSurfaces()?.ActivityView}
      fallback={
        <div class="@container/u-list flex size-full flex-col">
          <SplitHeaderLeft>
            <span class="font-semibold text-sm">Activity</span>
          </SplitHeaderLeft>
          <FeedContent />
        </div>
      }
    >
      {(ActivityView) => (
        <Dynamic
          component={ActivityView()}
          events={feed.data ?? []}
          isLoading={feed.isLoading}
          isError={feed.isError}
          hasNextPage={feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          onFetchNextPage={() => void feed.fetchNextPage()}
        >
          <FeedContent experimental />
        </Dynamic>
      )}
    </Show>
  );
}

function FeedGroups(props: {
  groups: FeedGroup[];
  row: Component<{ event: ActivityEvent; experimental?: boolean }>;
  experimental?: boolean;
}) {
  return (
    <For each={props.groups}>
      {(group) => (
        <>
          <Show
            when={props.experimental}
            fallback={<SoupSectionHeader>{group.label}</SoupSectionHeader>}
          >
            <div class="flex items-center gap-2 px-2 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-extra-muted">
              <span class="shrink-0">{group.label}</span>
              <span class="h-px min-w-4 flex-1 bg-edge-muted/80" />
            </div>
          </Show>
          <For each={group.events}>
            {(event) => (
              <props.row
                event={event}
                experimental={props.experimental}
              />
            )}
          </For>
        </>
      )}
    </For>
  );
}

function Timestamp(props: { event: ActivityEvent }) {
  return (
    <span class="ml-auto shrink-0 text-right font-medium text-ink-extra-muted text-xs">
      {formatRelativeTimestamp(new Date(props.event.occurredAt), {
        condensed: true,
      })}
    </span>
  );
}

/**
 * "<actor> <action> on <entity>": the glyph rail with a full sentence —
 * actor in medium weight, verb muted, the natural connector per action
 * kind, and the entity as a real mention.
 */
export function SentenceTimelineRow(props: {
  event: ActivityEvent;
  experimental?: boolean;
}) {
  const entityType = () => displayEntityType(props.event.entityType);

  return (
    <div
      class={cn(
        'flex items-stretch gap-1 text-sm',
        props.experimental
          ? 'w-full'
          : 'mx-1 w-[calc(100%-0.5rem)] px-2'
      )}
    >
      <div class="relative flex w-6 shrink-0 items-center justify-center">
        <div class="absolute inset-y-0 w-px bg-edge-muted" />
        <span class="relative flex size-5 items-center justify-center rounded-full bg-surface ring ring-edge-muted">
          <ActionGlyph
            action={props.event.action}
            class="size-3 text-ink-muted"
          />
        </span>
      </div>
      <Show
        when={entityType()}
        fallback={
          <div class={ROW_BODY_CLASS}>
            <span class="shrink-0 font-medium">
              <ActorName actorId={props.event.actorId} />
            </span>
            <span class="min-w-0 truncate text-ink-muted">
              <ActionPhrase event={props.event} />
            </span>
            <Timestamp event={props.event} />
          </div>
        }
      >
        {(type) => <EntityRow event={props.event} entityType={type()} />}
      </Show>
    </div>
  );
}

const ROW_BODY_CLASS =
  'flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-hover/30';

/**
 * A feed row that names its entity. Resolves the entity's display once and
 * shares it between the row-wide click-to-open (shift-click for a new split,
 * same target as the inline mention) and the mention itself. Rows whose
 * entity isn't linkable (inaccessible, unmapped type) stay inert.
 */
function EntityRow(props: { event: ActivityEvent; entityType: EntityType }) {
  const parts = () => describeActionForEntity(props.event.action);
  const display = usePropertyEntityDisplay(
    () => props.event.entityId,
    () => props.entityType
  );
  const navHandlers = useSplitNavigationHandler<HTMLDivElement>((e) => {
    const block = display.blockOrFileType();
    if (!block) return;
    openDocument(block, props.event.entityId, display.linkParams(), e.shiftKey);
  });

  return (
    <div {...navHandlers} class={ROW_BODY_CLASS}>
      <span class="shrink-0 font-medium">
        <ActorName actorId={props.event.actorId} />
      </span>
      <span class="min-w-0 text-ink-muted">
        <Show
          when={actionAsPropertyChange(props.event.action)}
          fallback={parts().verb}
        >
          {(change) => <PropertyChangeText action={change()} />}
        </Show>
      </span>
      <Show when={parts().connector}>
        {(connector) => (
          <span class="shrink-0 text-ink-muted">{connector()}</span>
        )}
      </Show>
      <span class="min-w-0 truncate">
        <EntityMention entityId={props.event.entityId} display={display} />
      </span>
      <Timestamp event={props.event} />
    </div>
  );
}

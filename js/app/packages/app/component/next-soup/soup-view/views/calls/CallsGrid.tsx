import type { SoupRow } from '@app/component/next-soup/create-soup-state';
import { SoupEntityContextMenu } from '@app/component/next-soup/soup-view/soup-entity-context-menu';
import { formatCallDuration } from '@block-call/utils';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { CallRecordName } from '@entity/components/CallRecordName';
import { Entity } from '@entity/entity';
import type { CallEntity } from '@entity/types/entity';
import { usePropertyEntityDisplay } from '@property/hooks';
import { useCallRecordQuery } from '@queries/call/call';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { cn } from '@ui';
import { createSignal, For, Show } from 'solid-js';

/** How many of the most recent calls are lifted out of the list into cards. */
export const CALLS_GRID_COUNT = 4;

/**
 * Narrowest list-column width (px) the card grid renders at. Below this the
 * two-column grid would collapse to a single column, so the grid turns off
 * and the calls render as normal list rows instead.
 */
export const CALLS_GRID_MIN_WIDTH = 520;

const MAX_ATTENDEE_PILLS = 3;

function AttendeePill(props: { userId: string }) {
  const { name } = usePropertyEntityDisplay(
    () => props.userId,
    () => EntityType.USER,
    { fallbackIcon: null }
  );
  return (
    <span class="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-edge-muted bg-surface py-0.5 pl-0.5 pr-2 text-xs leading-none text-ink-muted">
      <span class="size-4 shrink-0 overflow-hidden rounded-full">
        <UserIcon id={props.userId} isDeleted={false} size="fill" />
      </span>
      <span class="ph-no-capture max-w-24 truncate">{name()}</span>
    </span>
  );
}

/**
 * The recording preview only exists on the full call record — the soup list
 * payload doesn't carry it — so each card fetches its record (shared with the
 * cache the opened call entity uses) and renders the presigned poster image.
 */
function CallCardPreview(props: { entity: CallEntity }) {
  const record = useCallRecordQuery(() => props.entity.id);
  const [failed, setFailed] = createSignal(false);
  const previewUrl = () =>
    failed() ? undefined : record.data?.recordingPreviewUrl;

  return (
    <div class="relative aspect-video w-full shrink-0 overflow-hidden bg-ink/5">
      <Show
        when={previewUrl()}
        fallback={
          <div class="grid size-full place-items-center">
            <span class="size-7 text-ink-extra-muted">
              <EntityIcon targetType="call" size="fill" theme="monochrome" />
            </span>
          </div>
        }
      >
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            onError={() => setFailed(true)}
            class="size-full object-cover"
          />
        )}
      </Show>
      <Show when={props.entity.durationMs}>
        {(ms) => (
          <span class="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
            {formatCallDuration(ms())}
          </span>
        )}
      </Show>
    </div>
  );
}

function CallCard(props: {
  entity: CallEntity;
  highlighted: boolean;
  onClick: (event: MouseEvent) => void;
  onMouseMove?: () => void;
}) {
  const overflowCount = () =>
    props.entity.participantIds.length - MAX_ATTENDEE_PILLS;

  return (
    <div
      role="button"
      data-highlighted={props.highlighted || undefined}
      onClick={props.onClick}
      onMouseMove={props.onMouseMove}
      class={cn(
        'flex size-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-edge-muted bg-surface text-left',
        'hover:bg-hover/30 data-highlighted:border-accent/40 data-highlighted:bg-hover/30'
      )}
    >
      <CallCardPreview entity={props.entity} />
      <div class="flex min-h-0 flex-1 flex-col gap-1.5 p-3">
        <div class="flex items-baseline gap-2">
          <span class="ph-no-capture min-w-0 flex-1 truncate text-sm font-semibold">
            <CallRecordName entity={props.entity} />
          </span>
          <span class="shrink-0 text-xs font-medium text-ink-extra-muted">
            <Entity.Timestamp entity={props.entity} />
          </span>
        </div>
        <Show when={props.entity.summary}>
          {(summary) => (
            <p class="ph-no-capture line-clamp-3 text-xs leading-relaxed text-ink/60">
              {summary()}
            </p>
          )}
        </Show>
        <Show when={props.entity.participantIds.length > 0}>
          <div class="mt-auto flex min-w-0 flex-wrap items-center gap-1 pt-1">
            <For
              each={props.entity.participantIds.slice(0, MAX_ATTENDEE_PILLS)}
            >
              {(userId) => <AttendeePill userId={userId} />}
            </For>
            <Show when={overflowCount() > 0}>
              <span class="rounded-full bg-ink/10 px-1.5 py-1 text-xs leading-none text-ink-extra-muted tabular-nums">
                +{overflowCount()}
              </span>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

/**
 * Card grid for the most recent calls, shown above the calls list on desktop.
 * Two columns by default, four when the list column is @4xl wide. The rows
 * passed here are removed from the list by the caller.
 */
export function CallsGrid(props: {
  rows: SoupRow[];
  onEntityClick: (row: SoupRow, event: MouseEvent) => void;
  onEntityMouseMove?: (row: SoupRow) => void;
}) {
  return (
    <div class="grid shrink-0 grid-cols-2 items-stretch gap-2 px-2 pb-1 pt-2 @4xl/u-list:grid-cols-4">
      <For each={props.rows}>
        {(row) => (
          <SoupEntityContextMenu entity={row.original}>
            <CallCard
              entity={row.original as CallEntity}
              highlighted={row.isFocused()}
              onClick={(event) => props.onEntityClick(row, event)}
              onMouseMove={() => props.onEntityMouseMove?.(row)}
            />
          </SoupEntityContextMenu>
        )}
      </For>
    </div>
  );
}

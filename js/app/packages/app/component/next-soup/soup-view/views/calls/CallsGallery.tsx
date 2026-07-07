import type { SoupRow } from '@app/component/next-soup/create-soup-state';
import { SoupEntityContextMenu } from '@app/component/next-soup/soup-view/soup-entity-context-menu';
import { usePreference } from '@app/preferences/use-preference';
import { formatCallDuration } from '@block-call/utils';
import { EntityIcon } from '@core/component/EntityIcon';
import { TabsInset } from '@core/component/TabsInset';
import { UserIcon } from '@core/component/UserIcon';
import { CallRecordName } from '@entity/components/CallRecordName';
import { Entity } from '@entity/entity';
import type { CallEntity } from '@entity/types/entity';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ListIcon from '@phosphor/list.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import SquaresFourIcon from '@phosphor/squares-four.svg';
import { usePropertyEntityDisplay } from '@property/hooks';
import { useCallRecordQuery } from '@queries/call/call';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button, cn, Tooltip } from '@ui';
import { createEffect, createSignal, For, on, onCleanup, Show } from 'solid-js';

export type CallsLayoutMode = 'gallery' | 'list';

/**
 * Module-scope so the header toggle and the list body read the same reactive
 * source (usePreference creates an independent signal per call, so two
 * component-level calls with the same key would not stay in sync live).
 */
const [callsLayoutMode, setCallsLayoutMode] = usePreference<CallsLayoutMode>(
  'macro:pref:soup:calls:layout',
  { default: 'gallery' }
);

export { callsLayoutMode };

/**
 * Narrowest list-column width (px) the gallery renders at. Below this the
 * two-column grid would collapse to a single column, so the gallery falls
 * back to normal list rows regardless of the toggle.
 */
const CALLS_GALLERY_MIN_WIDTH = 520;
const CALLS_GALLERY_FOUR_COLUMN_WIDTH = 896;

/** Card columns for a given list-column width; 0 disables the gallery. */
export function getCallsGalleryColumns(width: number): number {
  if (width < CALLS_GALLERY_MIN_WIDTH) return 0;
  return width < CALLS_GALLERY_FOUR_COLUMN_WIDTH ? 2 : 4;
}

/** Finder-style gallery/list switch shown in the calls view header. */
export function CallsLayoutToggle() {
  return (
    <TabsInset
      list={[
        {
          value: 'gallery',
          label: (
            <Tooltip label="Gallery view" as="span">
              <span class="flex items-center" aria-label="Gallery view">
                <SquaresFourIcon class="size-3.5" />
              </span>
            </Tooltip>
          ),
        },
        {
          value: 'list',
          label: (
            <Tooltip label="List view" as="span">
              <span class="flex items-center" aria-label="List view">
                <ListIcon class="size-3.5" />
              </span>
            </Tooltip>
          ),
        },
      ]}
      value={callsLayoutMode()}
      onChange={(value) => setCallsLayoutMode(value as CallsLayoutMode)}
    />
  );
}

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
 * Don't fetch a card's record until it has stayed mounted this long —
 * flinging the scrollbar through a large calls list mounts and unmounts
 * hundreds of cards, and those fetches are heavy (full transcript) and
 * uncancellable. Cards scrolled past never fetch.
 */
const CARD_FETCH_SETTLE_MS = 150;

/**
 * Treat a fetched record as fresh for this long so scrolling a card back
 * into view reuses the cache instead of refetching. The preview image is a
 * presigned URL with a 1h TTL, so a 10-minute window is comfortably safe;
 * the opened call entity uses its own observer with the default staleTime
 * and still refetches fresh data.
 */
const CARD_RECORD_STALE_MS = 10 * 60 * 1000;
const CARD_RECORD_GC_MS = 30 * 60 * 1000;

/**
 * The recording preview only exists on the full call record — the soup list
 * payload doesn't carry it — so each card fetches its record (shared with the
 * cache the opened call entity uses) and renders the presigned poster image.
 */
function CallCardPreview(props: { entity: CallEntity }) {
  const [settled, setSettled] = createSignal(false);
  const settleTimer = setTimeout(() => setSettled(true), CARD_FETCH_SETTLE_MS);
  onCleanup(() => clearTimeout(settleTimer));

  const record = useCallRecordQuery(() => props.entity.id, {
    enabled: settled,
    staleTime: CARD_RECORD_STALE_MS,
    gcTime: CARD_RECORD_GC_MS,
  });
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
            loading="lazy"
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
 * Cards shown per gallery page. A page renders as a plain grid with no
 * virtualization — a bounded page keeps the DOM small by construction, which
 * sidesteps the estimate-vs-measured churn a virtualizer hits with tall
 * variable-height cards.
 */
export const GALLERY_PAGE_SIZE = 12;

/**
 * Paged gallery of call cards with a pager at the bottom. `rows` is every
 * call row loaded so far; the view slices out the current page. Cards keep
 * click/focus/context-menu parity with list rows.
 */
export function CallsGalleryView(props: {
  rows: SoupRow[];
  columns: number;
  page: number;
  /** More rows exist beyond what's loaded (soup query has another page). */
  hasMore: boolean;
  isFetchingMore: boolean;
  onPageChange: (page: number) => void;
  onEntityClick: (row: SoupRow, event: MouseEvent) => void;
  onEntityMouseMove?: (row: SoupRow) => void;
  scrollerRef?: (el: HTMLElement) => void;
}) {
  let scroller: HTMLDivElement | undefined;

  const pageCount = () =>
    Math.max(1, Math.ceil(props.rows.length / GALLERY_PAGE_SIZE));
  const pageRows = () =>
    props.rows.slice(
      props.page * GALLERY_PAGE_SIZE,
      (props.page + 1) * GALLERY_PAGE_SIZE
    );
  const hasNext = () => props.page + 1 < pageCount();

  createEffect(
    on(
      () => props.page,
      () => scroller?.scrollTo({ top: 0 })
    )
  );

  return (
    <div
      ref={(el) => {
        scroller = el;
        props.scrollerRef?.(el);
      }}
      class="flex-1 min-h-0 overflow-y-auto overscroll-none scrollbar-hidden"
    >
      <div
        class="grid items-stretch gap-2 px-2 py-2"
        style={{
          'grid-template-columns': `repeat(${props.columns}, minmax(0, 1fr))`,
        }}
      >
        <For each={pageRows()}>
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
      <div class="flex items-center justify-center gap-2 py-2">
        <Button
          variant="base"
          size="sm"
          depth={2}
          class="bg-surface"
          disabled={props.page === 0}
          onClick={() => props.onPageChange(props.page - 1)}
          label="Previous page"
        >
          <CaretLeftIcon class="size-2.5" />
          Prev
        </Button>
        <span class="px-2 text-xs text-ink-muted tabular-nums">
          Page {props.page + 1} of {pageCount()}
          {props.hasMore ? '+' : ''}
        </span>
        <Button
          variant="base"
          size="sm"
          depth={2}
          class="bg-surface"
          disabled={!hasNext()}
          onClick={() => props.onPageChange(props.page + 1)}
          label="Next page"
        >
          Next
          <CaretRightIcon class="size-2.5" />
        </Button>
        <Show when={props.isFetchingMore && !hasNext()}>
          <SpinnerIcon class="size-3 animate-spin text-ink-extra-muted" />
        </Show>
      </div>
      {/* Clearance for the floating AI input that overlays the panel bottom
          (same as the list's trailing spacer). */}
      <div class="h-15" />
    </div>
  );
}

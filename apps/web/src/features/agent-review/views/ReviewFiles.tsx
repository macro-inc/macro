import { DiffCounts } from '@app/components/diff-view/DiffCounts';
import { splitPath } from '@app/components/diff-view/model/diff-file';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { createWritableMemo } from '@solid-primitives/memo';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { Button, Card } from '@ui';
import { createEffect, createMemo, For, type JSX, on, Show } from 'solid-js';
import { ReviewCode } from '../components/ReviewCode';
import { useReviewHost } from '../context/review-context';
import type { CodeLocation } from '../core/model';
import type { ReviewEntry } from '../core/source';
import { errorMessage } from '../primitives/create-review';

type Props = {
  files: ReviewEntry[];
  revision?: number;
  active: boolean;
  disabled: boolean;
  wide: boolean;
  target?: CodeLocation;
  sequence: number | string;
  search: string;
  expanded: ReadonlySet<string>;
  onExpand: (path: string) => void;
  onActiveFile: (path: string) => void;
  onSearch: (path: string) => void;
  discussions: CodeLocation[];
  renderDiscussion: (at: CodeLocation) => JSX.Element;
  onSelect: (at: CodeLocation) => void;
  onComment: (at: CodeLocation) => void;
  onCopy: (at: CodeLocation) => void;
  readOnly: boolean;
};

const estimate = (file: ReviewEntry | undefined) =>
  !file || file.collapsed || file.omitted
    ? 144
    : 42 + Math.max(100, Math.min(4000, (file.added + file.removed + 12) * 18));

/** File and line windows share one scroll element; only nearby bodies are loaded. */
export function ReviewFiles(props: Props) {
  let scroll!: HTMLDivElement;
  let anchor: { path: string; offset: number } | undefined;
  let trackScroll = false;
  const order = createMemo(
    () => props.files.map((file) => file.path),
    undefined,
    {
      equals: (a, b) =>
        Boolean(
          a && a.length === b.length && a.every((path, i) => path === b[i])
        ),
    }
  );
  const itemKey = createMemo(() => {
    const paths = order();
    return (index: number) => paths[index] ?? index;
  });
  const [jump, setJump] = createWritableMemo(
    on(
      () => props.sequence,
      () => props.target
    )
  );
  const virtualizer = createVirtualizer({
    get count() {
      return props.files.length;
    },
    // Disconnect observers while closed without clearing measurements or the
    // mounted file window, which owns expanded context and row measurements.
    getScrollElement: () => (props.active ? scroll : null),
    get getItemKey() {
      return itemKey();
    },
    estimateSize: (index) => estimate(props.files[index]),
    gap: 12,
    paddingStart: 12,
    paddingEnd: 96,
    overscan: 1,
  });
  // Inner line measurements own the visible file's anchor; the outer window
  // compensates only for a whole file changing above the viewport.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) =>
    item.key !== props.target?.path && item.end <= (scroll?.scrollTop ?? 0);
  createEffect(
    on(
      [order, () => props.sequence, () => props.active],
      (current, previous) => {
        if (!props.active) return;
        trackScroll = false;
        const at = jump();
        if (!at && previous?.[0] === current[0] && previous[1] === current[1])
          return;
        const path = at?.path ?? props.target?.path ?? anchor?.path;
        const offset =
          !at && anchor && anchor.path === path ? anchor.offset : 0;
        const index = props.files.findIndex((file) => file.path === path);
        if (index < 0) return;
        queueMicrotask(() => {
          // A mounted line window may already have reached this target. Its
          // precise position takes precedence over revealing the file header.
          if (at && jump() !== at) return;
          virtualizer.getVirtualItems();
          const position = virtualizer.measurementsCache[index];
          if (position) virtualizer.scrollToOffset(position.start + offset);
        });
      }
    )
  );
  return (
    <div
      ref={scroll}
      data-review-scroll
      class="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-page outline-none"
      tabIndex={0}
      aria-label={`Code changes in ${props.target?.path ?? 'this review'}`}
      aria-busy={props.disabled}
      onWheel={() => {
        trackScroll = true;
      }}
      onPointerDown={(event) => {
        trackScroll = event.pointerType === 'touch' || event.target === scroll;
      }}
      onKeyDown={(event) => {
        if (
          [
            'ArrowUp',
            'ArrowDown',
            'PageUp',
            'PageDown',
            'Home',
            'End',
            ' ',
          ].includes(event.key)
        )
          trackScroll = true;
      }}
      onScroll={() => {
        if (!props.active || jump()) return;
        const tracking = trackScroll && !props.search;
        const item = virtualizer
          .getVirtualItems()
          .find((item) =>
            tracking
              ? item.end > scroll.scrollTop + 40
              : props.files[item.index]?.path === props.target?.path
          );
        const file = item && props.files[item.index];
        if (!file || !item) return;
        anchor = { path: file.path, offset: scroll.scrollTop - item.start };
        if (tracking) props.onActiveFile(file.path);
      }}
    >
      <div
        class="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(item) => (
            <Show when={props.files[item.index]}>
              {(entry) => (
                <Card
                  data-index={item.index}
                  data-review-file={entry().path}
                  class="absolute inset-x-3 overflow-clip bg-surface"
                  style={{ top: `${item.start}px` }}
                  ref={(element) =>
                    createEffect(
                      on(
                        () => item.key,
                        () => virtualizer.measureElement(element)
                      )
                    )
                  }
                >
                  <ReviewFile
                    {...props}
                    entry={entry()}
                    scroll={scroll}
                    offset={item.start}
                    jump={jump()?.path === entry().path}
                    onReveal={() => setJump(undefined)}
                    onProgrammaticScroll={() => {
                      trackScroll = false;
                    }}
                  />
                </Card>
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
  );
}

function ReviewFile(
  props: Props & {
    entry: ReviewEntry;
    scroll: HTMLDivElement;
    offset: number;
    jump: boolean;
    onReveal: () => void;
    onProgrammaticScroll: () => void;
  }
) {
  const host = useReviewHost();
  const open = () =>
    !props.entry.collapsed ||
    props.expanded.has(props.entry.path) ||
    (Boolean(host.target()) && props.target?.path === props.entry.path);
  const source = host.createFile(
    () => props.revision,
    () => props.entry.path,
    () => props.active && open()
  );
  const body = source.value;
  const path = () => splitPath(props.entry.path);
  const split = () => props.wide && Boolean(body()?.old && body()?.new);
  const discussions = createMemo(() =>
    props.discussions.filter((at) => at.path === props.entry.path)
  );
  createEffect(
    on([() => props.jump, open, source.phase], () => {
      if (props.jump && (!open() || source.phase() === 'error'))
        props.onReveal();
    })
  );
  return (
    <>
      <header
        class="sticky top-0 z-10 flex h-10 items-center gap-3 border-b border-edge-muted bg-surface px-3"
        data-review-file-header
      >
        <span
          class="flex min-w-0 flex-1 items-baseline text-xs"
          title={props.entry.path}
        >
          <span class="min-w-0 truncate text-ink-subtle">{path().dir}</span>
          <span class="shrink-0 font-medium text-ink">{path().base}</span>
        </span>
        <span class="text-[11px]">
          <DiffCounts
            additions={props.entry.added}
            deletions={props.entry.removed}
          />
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Find in file (/)"
          onClick={() => props.onSearch(props.entry.path)}
        >
          <SearchIcon />
        </Button>
      </header>
      <Show
        when={open()}
        fallback={
          <div class="px-4 py-6 text-xs text-ink-muted">
            <p>{props.entry.collapsed}</p>
            <Button
              size="sm"
              variant="ghost"
              class="mt-2"
              onClick={() => props.onExpand(props.entry.path)}
            >
              Expand file
            </Button>
          </div>
        }
      >
        <Show
          when={source.phase() !== 'error'}
          fallback={
            <div role="alert" class="px-4 py-6 text-sm text-ink-muted">
              {errorMessage(source.error())}{' '}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void source.refresh()}
              >
                Retry
              </Button>
            </div>
          }
        >
          <Show
            when={body()}
            fallback={
              <div
                class="bg-surface px-4 py-6 text-xs text-ink-muted"
                style={{ height: `${estimate(props.entry) - 40}px` }}
              >
                Loading file…
              </div>
            }
          >
            {(file) => (
              <ReviewCode
                file={file()}
                active={props.active}
                split={split()}
                wrap
                fullContext={false}
                disabled={props.disabled || source.phase() !== 'ready'}
                viewport={{ element: props.scroll, offset: props.offset + 41 }}
                target={props.target}
                targetSequence={props.sequence}
                scrollToTarget={props.jump}
                onReveal={props.onReveal}
                onProgrammaticScroll={props.onProgrammaticScroll}
                discussions={discussions()}
                renderDiscussion={props.renderDiscussion}
                onSelect={props.onSelect}
                onComment={props.onComment}
                onCopy={props.onCopy}
                readOnly={props.readOnly}
                search={
                  props.target?.path === props.entry.path ? props.search : ''
                }
              />
            )}
          </Show>
        </Show>
      </Show>
    </>
  );
}

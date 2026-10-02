import { createWritableMemo } from '@solid-primitives/memo';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { Button, cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { lineHtml } from '../core/line-html';
import {
  type CodeLocation,
  type CodeRow,
  displayRows,
  type ReviewFile,
  type Side,
} from '../core/model';

import {
  type ExpandedContext,
  type ReaderItem,
  readerItems,
} from '../core/reader-items';
import { ReviewFold } from './ReviewFold';
import { ReviewSelection } from './ReviewSelection';

export function ReviewCode(props: {
  file: ReviewFile;
  split: boolean;
  wrap?: boolean;
  fullContext?: boolean;
  disabled?: boolean;
  active?: boolean;
  target?: CodeLocation;
  targetSequence: number | string;
  discussions: CodeLocation[];
  renderDiscussion: (location: CodeLocation) => JSX.Element;
  onSelect: (location: CodeLocation) => void;
  onCopy: (location: CodeLocation) => void;
  onComment?: (location: CodeLocation) => void;
  readOnly?: boolean;
  search: string;
  viewport?: { element: HTMLDivElement; offset: number };
  scrollToTarget?: boolean;
  onReveal?: () => void;
  onProgrammaticScroll?: () => void;
}) {
  let scroll!: HTMLDivElement;
  const viewport = () => props.viewport?.element ?? scroll;
  const [margin, setMargin] = createSignal<number>();
  const navigation = createMemo(() =>
    JSON.stringify([props.targetSequence, props.file.path, props.split])
  );
  // Selecting already visible rows must not rebuild a potentially huge file.
  const revealedTarget = createMemo(
    on(navigation, () =>
      props.target?.path === props.file.path ? props.target : undefined
    )
  );
  const selectionContext = () => `${navigation()}:${props.target?.path ?? ''}`;
  const [picked, setPicked] = createWritableMemo<CodeLocation | undefined>(
    on(selectionContext, (): CodeLocation | undefined => undefined)
  );
  const [showActions, setShowActions] = createWritableMemo(
    on(selectionContext, () => false)
  );
  const [dismissed, setDismissed] = createWritableMemo(
    on(selectionContext, () => false)
  );
  const clearSelection = () => {
    setPicked(undefined);
    setShowActions(false);
    setDismissed(true);
  };
  const pick = (at: CodeLocation) => {
    props.onSelect(at);
    setPicked(at);
    setShowActions(true);
    setDismissed(false);
  };
  const solo = () => !props.file.old || !props.file.new;
  const [selection, setSelection] = createSignal<CodeLocation>();
  let drag:
    | {
        pointer: number;
        start: CodeLocation;
        x: number;
        y: number;
        gutter: boolean;
        moved: boolean;
      }
    | undefined;
  let pointerY = 0;
  let autoScroll: ReturnType<typeof setInterval> | undefined;
  const stopSelection = () => {
    if (autoScroll) clearInterval(autoScroll);
    autoScroll = undefined;
    const pointer = drag?.pointer;
    drag = undefined;
    if (pointer !== undefined && scroll?.hasPointerCapture(pointer))
      scroll.releasePointerCapture(pointer);
    setSelection(undefined);
  };
  onCleanup(stopSelection);
  createEffect(
    on(
      [() => props.file.path, () => props.disabled, () => props.active],
      stopSelection
    )
  );
  const extendSelection = () => {
    if (!drag) return;
    const bounds = viewport().getBoundingClientRect();
    const element = document.elementFromPoint(
      drag.x,
      Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, pointerY))
    );
    const cell = element?.closest<HTMLElement>('[data-review-line]');
    if (
      !cell ||
      !scroll.contains(cell) ||
      cell.dataset.reviewSide !== drag.start.side
    )
      return;
    const line = Number(cell.dataset.reviewLine);
    if (
      selection()?.line === Math.min(drag.start.line, line) &&
      selection()?.endLine === Math.max(drag.start.line, line)
    )
      return;
    setSelection({
      ...drag.start,
      line: Math.min(drag.start.line, line),
      endLine: Math.max(drag.start.line, line),
    });
  };
  const startSelection: JSX.EventHandler<HTMLDivElement, PointerEvent> = (
    event
  ) => {
    if (
      props.disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      !(event.target instanceof Element)
    )
      return;
    const cell = event.target.closest<HTMLElement>('[data-review-line]');
    const gutter = Boolean(event.target.closest('[data-review-gutter]'));
    if (
      !cell ||
      !scroll.contains(cell) ||
      (!gutter && event.target.closest('button, a, input, textarea')) ||
      (event.pointerType === 'touch' && !gutter)
    )
      return;
    const side = cell.dataset.reviewSide;
    if (side !== 'old' && side !== 'new') return;
    event.preventDefault();
    scroll.focus({ preventScroll: true });
    const at: CodeLocation = {
      path: props.file.path,
      side,
      line: Number(cell.dataset.reviewLine),
    };
    const start =
      event.shiftKey &&
      props.target?.path === at.path &&
      props.target.side === side
        ? props.target
        : at;
    drag = {
      pointer: event.pointerId,
      start,
      x: event.clientX,
      y: event.clientY,
      gutter,
      moved: false,
    };
    pointerY = event.clientY;
    setSelection({
      ...at,
      line: Math.min(start.line, at.line),
      endLine: Math.max(start.line, at.line),
    });
    scroll.setPointerCapture(event.pointerId);
    autoScroll = setInterval(() => {
      if (!drag?.moved) return;
      const bounds = viewport().getBoundingClientRect();
      const distance =
        pointerY < bounds.top + 28
          ? pointerY - bounds.top - 28
          : pointerY > bounds.bottom - 28
            ? pointerY - bounds.bottom + 28
            : 0;
      if (!distance) return;
      viewport().scrollTop += Math.max(-28, Math.min(28, distance));
      extendSelection();
    }, 16);
  };
  let horizontalScroll: HTMLDivElement | undefined;
  const [horizontalOffset, setHorizontalOffset] = createSignal(0);
  createEffect(
    on([() => props.file.path, () => props.wrap], () => {
      setHorizontalOffset(0);
      horizontalScroll?.scrollTo({ left: 0 });
    })
  );
  const rows = createMemo(() => displayRows(props.file, props.split));
  const [expanded, setExpanded] = createWritableMemo<
    readonly ExpandedContext[]
  >(
    on(
      () => props.file.path,
      (): readonly ExpandedContext[] => []
    )
  );
  const items = createMemo((): ReaderItem[] =>
    readerItems(
      rows(),
      props.discussions,
      revealedTarget(),
      props.fullContext !== false || Boolean(props.search),
      expanded()
    )
  );
  const [horizontalWidth, setHorizontalWidth] = createSignal(0);
  const rowKeyPrefix = createMemo(() => `${props.file.path}:${props.split}`);
  let savedScroll = 0;
  const virtualizer = createVirtualizer({
    initialOffset: () => props.viewport?.element.scrollTop ?? savedScroll,
    get count() {
      return items().length;
    },
    getScrollElement: () => (props.active === false ? null : viewport()),
    get scrollMargin() {
      return props.viewport ? (margin() ?? props.viewport.offset) : 0;
    },
    get scrollPaddingStart() {
      return props.viewport ? 40 : 0;
    },
    estimateSize: (index) =>
      items()[index]?.kind === 'discussion'
        ? 160
        : items()[index]?.kind === 'fold'
          ? 28
          : 18,
    getItemKey: (index) => {
      const item = items()[index];
      return `${rowKeyPrefix()}:${item?.kind === 'code' ? item.row.key : item?.kind === 'fold' ? `fold:${item.start}` : `discussion:${item?.location.side}:${item?.location.line}`}`;
    },
    overscan: 14,
  });
  // The file window compensates changes above the active file. Only its own
  // line window may adjust the shared viewport, avoiding a double adjustment.
  createEffect(() => {
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange =
      props.viewport && props.target?.path !== props.file.path
        ? () => false
        : undefined;
  });
  const expandContext = (range: ExpandedContext) => {
    const foldIndex = items().findIndex(
      (item) =>
        item.kind === 'fold' && item.start <= range[0] && item.end >= range[1]
    );
    const fold = items()[foldIndex];
    const code = virtualizer
      .getVirtualItems()
      .filter((item) => items()[item.index]?.kind === 'code');
    // Keep the code beside the expanded edge in place, even when the entire
    // folded file fits on screen and its first row precedes this gap.
    const above =
      fold?.kind === 'fold' && (range[0] > fold.start || fold.start === 0);
    const visible =
      (above
        ? code.find((item) => item.index > foldIndex)
        : code.findLast((item) => item.index < foldIndex)) ??
      code.find((item) => item.end > viewport().scrollTop);
    const anchor = visible && items()[visible.index];
    const offset = visible ? visible.start - viewport().scrollTop : 0;
    setExpanded((old) => [...old, range]);
    if (anchor?.kind !== 'code') return;
    // Inserting context above the viewport keeps the same source row in place.
    queueMicrotask(() => {
      const index = items().findIndex(
        (item) => item.kind === 'code' && item.row.key === anchor.row.key
      );
      virtualizer.getVirtualItems();
      const position = virtualizer.measurementsCache[index];
      if (position) {
        props.onProgrammaticScroll?.();
        virtualizer.scrollToOffset(Math.max(0, position.start - offset));
      }
    });
  };

  createEffect(
    on(
      [
        () => props.file.path,
        () => props.wrap,
        () => virtualizer.getVirtualItems(),
      ],
      () => {
        // Use rendered glyph widths, including tabs and fallback fonts, rather than
        // character counts. The bounded row window makes this measurement cheap.
        queueMicrotask(() => {
          const element = scroll;
          if (!element || props.wrap) return;
          let width = 0;
          for (const span of element.querySelectorAll('code > span'))
            width = Math.max(width, span.getBoundingClientRect().width);
          setHorizontalWidth(width);
        });
      }
    )
  );

  const reveal = (location: CodeLocation | undefined) => {
    if (
      props.active === false ||
      props.scrollToTarget === false ||
      (props.viewport && margin() === undefined) ||
      !viewport()?.clientHeight ||
      !location ||
      location.path !== props.file.path
    )
      return;
    const index = items().findIndex(
      (item) =>
        item.kind === 'code' && item.row[location.side] === location.line - 1
    );
    if (index >= 0) {
      props.onProgrammaticScroll?.();
      virtualizer.scrollToIndex(index, {
        align: props.viewport && location.line === 1 ? 'start' : 'center',
      });
    }
    props.onReveal?.();
  };

  onMount(() => {
    const element = scroll;
    // The first target can precede virtualizer measurement. ResizeObserver also
    // fires in a background browser tab, where animation frames may be paused.
    const observer = new ResizeObserver(() => {
      if (element.clientHeight === 0) return;
      measureMargin();
      reveal(props.target);
      if (!props.viewport) observer.disconnect();
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  });

  const measureMargin = () => {
    const external = props.viewport;
    if (external && scroll)
      setMargin(
        scroll.getBoundingClientRect().top -
          external.element.getBoundingClientRect().top +
          external.element.scrollTop
      );
  };
  createEffect(
    on(
      () => props.viewport?.offset,
      () => queueMicrotask(measureMargin)
    )
  );

  // Query updates can notify path accessors without changing their values. Only
  // an actual navigation intent may recenter the reader.
  createEffect(
    on([navigation, () => props.scrollToTarget], () =>
      queueMicrotask(() => reveal(props.target))
    )
  );

  const matches = createMemo(() => {
    const query = props.search.trim().toLowerCase();
    if (!query) return [];
    return items().flatMap((item, index) => {
      if (item.kind !== 'code') return [];
      const { old, new: next } = item.row;
      return (old !== null &&
        props.file.old?.lines[old]?.toLowerCase().includes(query)) ||
        (next !== null &&
          props.file.new?.lines[next]?.toLowerCase().includes(query))
        ? [index]
        : [];
    });
  });
  const searchTarget = createMemo(() =>
    JSON.stringify([props.search, props.file.path])
  );
  const [matchCursor, setMatchCursor] = createWritableMemo(
    on(searchTarget, () => 0)
  );
  const activeMatch = () =>
    Math.min(matchCursor(), Math.max(0, matches().length - 1));
  createEffect(
    on(searchTarget, () => {
      const found = matches();
      if (found.length) {
        props.onProgrammaticScroll?.();
        virtualizer.scrollToIndex(found[0], { align: 'center' });
      }
    })
  );

  const cell = (row: CodeRow, side: Side) => {
    const index = row[side];
    const source = props.file[side];
    const location = (): CodeLocation => ({
      path: props.file.path,
      side,
      line: (index ?? 0) + 1,
    });
    const active = () =>
      selection() ?? picked() ?? (dismissed() ? undefined : revealedTarget());
    const selected = () =>
      active()?.path === props.file.path &&
      active()?.side === side &&
      (index ?? -1) + 1 >= active()!.line &&
      (index ?? -1) + 1 <= (active()!.endLine ?? active()!.line);
    const changed = () =>
      index !== null &&
      ((source?.novel[index]?.length ?? 0) > 0 ||
        row[side === 'old' ? 'new' : 'old'] === null);
    return (
      <div
        data-review-line={index === null ? undefined : index + 1}
        data-review-side={side}
        data-selected={selected() ? '' : undefined}
        class={cn(
          'group flex min-w-0 items-stretch',
          side === 'old' && props.split && 'border-r border-edge-muted',
          index === null && 'review-empty-cell',
          !solo() &&
            changed() &&
            (side === 'old' ? 'bg-failure/8' : 'bg-success/8'),
          selected() && 'bg-accent/10'
        )}
      >
        <button
          type="button"
          data-review-gutter
          class={cn(
            'w-11 shrink-0 touch-none select-none border-l-2 border-transparent bg-ink/3 pr-2 text-right font-mono text-[11px] text-ink-subtle outline-none hover:bg-accent/15 focus-visible:ring-2 focus-visible:ring-edge-focus',
            !solo() &&
              changed() &&
              (side === 'old'
                ? 'border-failure text-failure'
                : 'border-success text-success'),
            !solo() &&
              changed() &&
              (side === 'old' ? 'bg-failure/10' : 'bg-success/10')
          )}
          disabled={index === null || props.disabled}
          aria-label={
            index === null
              ? 'No corresponding line'
              : `Select ${side} line ${index + 1}`
          }
          onClick={(event) => {
            if (event.detail !== 0) return;
            pick(
              event.shiftKey &&
                props.target?.path === props.file.path &&
                props.target.side === side
                ? {
                    ...location(),
                    line: Math.min(props.target.line, (index ?? 0) + 1),
                    endLine: Math.max(props.target.line, (index ?? 0) + 1),
                  }
                : location()
            );
          }}
        >
          {index === null ? '' : index + 1}
        </button>
        <span
          class={cn(
            'w-4 shrink-0 select-none text-center text-[11px]',
            side === 'old' ? 'text-failure' : 'text-success'
          )}
          aria-hidden="true"
        >
          {!solo() && changed() ? (side === 'old' ? '−' : '+') : ''}
        </span>
        <code
          class={cn(
            'min-w-0 flex-1 px-2 [tab-size:2] font-mono text-xs leading-[18px] text-ink',
            props.wrap
              ? 'whitespace-pre-wrap break-all'
              : 'overflow-hidden whitespace-pre'
          )}
        >
          <span
            class="block"
            style={
              props.wrap
                ? undefined
                : {
                    width: 'max-content',
                    transform: `translateX(-${horizontalOffset()}px)`,
                  }
            }
            innerHTML={
              index === null
                ? ''
                : lineHtml(
                    source?.lines[index] ?? '',
                    source?.syntax[index],
                    solo() ? undefined : source?.novel[index],
                    side
                  )
            }
          />
        </code>
      </div>
    );
  };

  return (
    <div
      class={cn(
        'review-reader relative flex min-h-0 flex-col',
        !props.viewport && 'flex-1'
      )}
      style={{
        background:
          'color-mix(in oklch, var(--color-surface) 96%, var(--color-ink))',
      }}
      data-review-solo={solo() ? '' : undefined}
    >
      <Show when={props.search}>
        <div
          class="flex items-center gap-2 border-b border-edge-muted px-4 py-1 text-xs text-ink-muted"
          role="status"
        >
          {matches().length ? activeMatch() + 1 : 0} /{' '}
          {matches().length.toLocaleString()} matches
          <Button
            size="xs"
            variant="ghost"
            disabled={!matches().length}
            onClick={() => {
              if (!matches().length) return;
              const index = (activeMatch() + 1) % matches().length;
              setMatchCursor(index);
              props.onProgrammaticScroll?.();
              virtualizer.scrollToIndex(matches()[index], { align: 'center' });
            }}
          >
            Next match ↓
          </Button>
        </div>
      </Show>
      <Show when={!props.file.rows.length}>
        <p class="p-8 text-sm text-ink-muted">
          {props.file.omitted === 'binary'
            ? 'Binary file — contents are not text.'
            : props.file.omitted === 'tooLarge'
              ? 'File contents exceed the capture budget. The file remains listed in this review.'
              : props.file.omitted === 'submodule'
                ? 'Submodule revision changed.'
                : 'This file has no text changes.'}
        </p>
      </Show>
      <div
        ref={scroll}
        data-review-scroll={props.viewport ? undefined : ''}
        class={cn(
          'min-h-0 outline-none',
          props.viewport
            ? 'relative'
            : 'flex-1 overflow-y-auto overflow-x-hidden overscroll-contain'
        )}
        tabIndex={0}
        aria-label={`Code changes in ${props.file.path}`}
        aria-busy={props.disabled}
        onScroll={(event) => {
          if (props.active !== false && event.currentTarget.clientHeight > 0)
            savedScroll = event.currentTarget.scrollTop;
        }}
        // Capture the line before body-level clickOutside handlers dismiss an
        // empty composer and move the virtualized rows under the pointer.
        on:pointerdown={startSelection}
        onPointerMove={(event) => {
          if (!drag || drag.pointer !== event.pointerId) return;
          pointerY = event.clientY;
          drag.moved ||=
            Math.abs(event.clientY - drag.y) > 3 ||
            Math.abs(event.clientX - drag.x) > 3;
          if (drag.moved) extendSelection();
        }}
        onPointerUp={(event) => {
          if (!drag || drag.pointer !== event.pointerId) return;
          const selected = selection();
          stopSelection();
          if (selected) pick(selected);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && picked()) {
            event.preventDefault();
            event.stopPropagation();
            clearSelection();
          }
        }}
        onPointerCancel={stopSelection}
        onLostPointerCapture={stopSelection}
      >
        <div
          class={cn(
            'relative w-full',
            solo() &&
              'mx-auto max-w-[1100px] border-x border-edge-muted/70 bg-code-buffer'
          )}
          style={{
            height: `${virtualizer.getTotalSize()}px`,
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(virtual) => {
              const item = () => items()[virtual.index];
              const row = () => {
                const current = item();
                return current?.kind === 'code' ? current.row : undefined;
              };
              return (
                <div
                  data-index={virtual.index}
                  ref={(element) => {
                    // Solid assigns dynamic attributes after refs. Register
                    // once data-index and the row's children are in the DOM,
                    // and again when the same slot represents another file.
                    createEffect(
                      on(
                        () => virtual.key,
                        () => virtualizer.measureElement(element)
                      )
                    );
                  }}
                  class="absolute left-0 top-0 flow-root w-full"
                  style={{
                    transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <Show
                    when={row()}
                    fallback={(() => {
                      const current = item();
                      return current?.kind === 'discussion' ? (
                        <div class={cn('grid', props.split && 'grid-cols-2')}>
                          <div
                            class={cn(
                              'min-w-0',
                              props.split &&
                                current.location.side === 'new' &&
                                'col-start-2'
                            )}
                          >
                            {props.renderDiscussion(current.location)}
                          </div>
                        </div>
                      ) : current?.kind === 'fold' ? (
                        <ReviewFold
                          fold={current}
                          rows={rows().length}
                          onExpand={expandContext}
                        />
                      ) : undefined;
                    })()}
                  >
                    {(code) => (
                      <div
                        class={cn(
                          props.wrap ? 'grid min-h-[18px]' : 'grid h-[18px]',
                          props.split && 'grid-cols-2',
                          matches()[activeMatch()] === virtual.index &&
                            'bg-accent/5'
                        )}
                        data-review-row
                        data-review-match={
                          matches()[activeMatch()] === virtual.index
                            ? 'current'
                            : undefined
                        }
                      >
                        <Show
                          when={props.split}
                          fallback={cell(
                            code(),
                            code().new === null ? 'old' : 'new'
                          )}
                        >
                          {cell(code(), 'old')}
                          {cell(code(), 'new')}
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
      <Show when={showActions() && picked()}>
        {(at) => {
          const toolbar = () => (
            <ReviewSelection
              location={at()}
              disabled={props.disabled}
              readOnly={props.readOnly}
              onCopy={() => props.onCopy(at())}
              onComment={() => {
                props.onComment?.(at());
                setShowActions(false);
              }}
              onDismiss={clearSelection}
            />
          );
          return props.viewport ? (
            <Portal mount={props.viewport.element.parentElement!}>
              {toolbar()}
            </Portal>
          ) : (
            toolbar()
          );
        }}
      </Show>
      <Show when={!props.wrap}>
        <div
          ref={horizontalScroll}
          class="shrink-0 overflow-x-auto overflow-y-hidden"
          aria-label="Horizontal code scroll"
          onScroll={(event) =>
            setHorizontalOffset(event.currentTarget.scrollLeft)
          }
        >
          <div
            style={{
              width: `calc(${horizontalWidth() + 100}px + ${props.split ? '50%' : '0px'})`,
              height: '14px',
            }}
          />
        </div>
      </Show>
    </div>
  );
}

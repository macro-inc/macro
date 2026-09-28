import { toast } from '@core/component/Toast/Toast';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { hasNativeEditMenu } from '@core/mobile/nativeEditMenu';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import GridIcon from '@phosphor/grid-four.svg';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import SparkleIcon from '@phosphor-icons/core/bold/sparkle-bold.svg?component-solid';
import LoadingIcon from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
import CheckSquareIcon from '@phosphor-icons/core/regular/check-square.svg?component-solid';
import LinkIcon from '@phosphor-icons/core/regular/link.svg?component-solid';
import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

type TouchOption = {
  key: string;
  content: () => JSX.Element;
  onSelect: () => void;
  disabled?: () => boolean;
};

// Toolbar buttons give no touch-down feedback: the ghost variant's
// hover/active overlays (and iOS's native tap flash) would light options up
// on every touch and mid-swipe, so they are forcibly neutralized.
const optionButtonClass =
  'px-2 text-xs rounded-md py-1.25 shrink-0 whitespace-nowrap hover:bg-none! active:bg-none! hover:text-ink-muted! [-webkit-tap-highlight-color:transparent]';
const arrowButtonClass =
  'rounded-md shrink-0 hover:bg-none! active:bg-none! hover:text-ink-muted! [-webkit-tap-highlight-color:transparent]';

/**
 * The touch-device selection toolbar, mirroring the native edit menu (which
 * is suppressed while the popup shows — see nativeEditMenu). Options are
 * partitioned into mutually exclusive pages of whole options that fit the
 * screen width (chevron widths included in the budget). The pages sit in a
 * sliding track: swiping drags it with the finger (with resistance at the
 * ends) and releasing past a threshold snaps one page over; chevrons move a
 * page at a time.
 *
 * Desktop renders MarkdownPopupToolbar instead; see MarkdownPopup for the
 * split.
 */
export function TouchSelectionToolbar(props: {
  canEdit: boolean;
  canComment: boolean;
  isConverting: boolean;
  /** False when the popup opened for a bare caret (inside a comment). */
  hasSelection: boolean;
  showTasksOption: boolean;
  showTableOption: boolean;
  showEditWithAiOption: boolean;
  /** The caret/selection touches an existing comment thread. */
  showOpenCommentOption: boolean;
  locationCopied: boolean;
  setPopupVisible: (visible: boolean) => void;
  onConvertToTasks: () => void;
  onConvertListToTable: () => void;
  onOpenComment: () => void;
  onShare: () => void;
  onInsertComment: () => void;
  onPaste: () => void;
  onEditWithAi: () => void;
}) {
  const options = createMemo<TouchOption[]>(() => {
    const list: TouchOption[] = [];
    const pasteOption: TouchOption = {
      key: 'paste',
      content: () => <>Paste</>,
      onSelect: () => props.onPaste(),
    };
    if (props.showOpenCommentOption) {
      list.push({
        key: 'open-comment',
        content: () => (
          <>
            <ChatTeardrop class="size-4" />
            Show comment
          </>
        ),
        onSelect: () => props.onOpenComment(),
      });
    }
    if (!props.hasSelection) {
      // Caret mode: only opening the comment and pasting apply — Paste also
      // stands in for the suppressed native caret menu.
      if (props.canEdit && hasNativeEditMenu()) {
        list.push(pasteOption);
      }
      return list;
    }
    if (props.showTasksOption) {
      list.push({
        key: 'tasks',
        content: () => (
          <>
            <Dynamic
              component={props.isConverting ? LoadingIcon : CheckSquareIcon}
              class="size-4"
            />
            {props.isConverting ? 'Converting...' : 'Tasks'}
          </>
        ),
        onSelect: () => props.onConvertToTasks(),
        disabled: () => props.isConverting,
      });
    }
    if (props.showTableOption) {
      list.push({
        key: 'table',
        content: () => (
          <>
            <GridIcon class="size-4" />
            Table
          </>
        ),
        onSelect: () => props.onConvertListToTable(),
      });
    }
    list.push({
      key: 'copy',
      content: () => <>Copy</>,
      // execCommand is also lexical's own programmatic copy path: it routes
      // through the editor's COPY_COMMAND handler, so the clipboard gets the
      // rich (html + lexical) payload. keepEditorFocus keeps the editor
      // selection alive for it.
      onSelect: () => {
        if (!document.execCommand('copy')) toast.failure('Could not copy');
        props.setPopupVisible(false);
      },
    });
    if (props.canEdit) {
      list.push({
        key: 'cut',
        content: () => <>Cut</>,
        onSelect: () => {
          if (!document.execCommand('cut')) toast.failure('Could not cut');
          props.setPopupVisible(false);
        },
      });
      if (hasNativeEditMenu()) {
        list.push(pasteOption);
      }
    }
    if (ENABLE_MARKDOWN_COMMENTS && props.canComment) {
      list.push({
        key: 'comment',
        content: () => (
          <>
            <ChatTeardrop class="size-4" />
            Comment
          </>
        ),
        onSelect: () => props.onInsertComment(),
      });
    }
    list.push({
      key: 'share',
      content: () => (
        <>
          <Dynamic
            component={props.locationCopied ? CheckIcon : LinkIcon}
            class={props.locationCopied ? 'text-success-ink size-4' : 'size-4'}
          />
          Share
        </>
      ),
      onSelect: () => props.onShare(),
    });
    if (props.showEditWithAiOption) {
      list.push({
        key: 'edit-with-ai',
        content: () => (
          <>
            <SparkleIcon class="size-4" />
            Edit with AI
          </>
        ),
        onSelect: () => props.onEditWithAi(),
      });
    }
    return list;
  });

  // --- Pagination ---------------------------------------------------------
  // The options render once into a hidden measuring row; its widths drive a
  // greedy partition into pages of whole options. Space for both chevrons is
  // reserved on every multi-page layout so a page never clips.

  /** Divider footprint: mx-1 (4px each side) around the 1px line. */
  const DIVIDER_SPACE = 9;
  /** Screen inset + popup chrome the row must leave free. */
  const PAGE_MARGIN = 48;
  /** Gap between pages in the sliding track. */
  const PAGE_GAP = 24;
  /** Drag distance at release that commits a page change. */
  const SWIPE_THRESHOLD = 48;
  /** Movement below this is a tap; above it, a drag (and the click is eaten). */
  const CLICK_SLOP = 10;

  type TouchPage = {
    options: TouchOption[];
    width: number;
  };

  let measureRowRef: HTMLDivElement | undefined;
  let measureArrowRef: HTMLDivElement | undefined;
  const [optionWidths, setOptionWidths] = createSignal<number[]>([]);
  const [arrowWidth, setArrowWidth] = createSignal(28);
  const [pageIndex, setPageIndex] = createSignal(0);

  const measure = () => {
    if (!measureRowRef) return false;
    const widths = Array.from(
      measureRowRef.querySelectorAll<HTMLElement>('button')
    ).map((button) => button.offsetWidth);
    if (widths.length === 0 || widths.some((width) => width === 0)) {
      return false;
    }
    setOptionWidths(widths);
    const arrow = measureArrowRef?.querySelector<HTMLElement>('button');
    if (arrow && arrow.offsetWidth > 0) setArrowWidth(arrow.offsetWidth);
    return true;
  };

  let lastOptionKeys: string | undefined;
  createEffect(() => {
    // Reset paging only when the option *set* changes (e.g. caret mode vs.
    // selection mode) — a cosmetic rerender of the same options (the Share
    // icon flipping to a check, the Tasks label while converting) keeps the
    // user's page; the clamp effect below handles any repartition.
    const keys = options()
      .map((option) => option.key)
      .join('\n');
    if (keys !== lastOptionKeys) {
      lastOptionKeys = keys;
      setPageIndex(0);
    }
    // Measure synchronously (a forced layout read) so the very first paint
    // already shows the paged layout — deferring to an animation frame lets
    // one unmeasured, full-width frame flash. Falls back a frame if layout
    // isn't ready yet, during which the toolbar renders nothing.
    if (!measure()) requestAnimationFrame(measure);
  });

  const pages = createMemo<TouchPage[]>(() => {
    const all = options();
    const widths = optionWidths();
    if (all.length === 0) return [];
    if (widths.length !== all.length) return [];

    const totalBudget = Math.max(120, window.innerWidth - PAGE_MARGIN);
    const totalWidth = widths.reduce(
      (sum, width, index) => sum + width + (index > 0 ? DIVIDER_SPACE : 0),
      0
    );
    if (totalWidth <= totalBudget) return [{ options: all, width: totalWidth }];
    const pageBudget = Math.max(
      80,
      totalBudget - 2 * (arrowWidth() + DIVIDER_SPACE)
    );
    const result: TouchPage[] = [];
    let currentOptions: TouchOption[] = [];
    let currentWidth = 0;
    all.forEach((option, index) => {
      const needed =
        currentOptions.length === 0
          ? widths[index]
          : currentWidth + DIVIDER_SPACE + widths[index];
      if (currentOptions.length > 0 && needed > pageBudget) {
        result.push({ options: currentOptions, width: currentWidth });
        currentOptions = [option];
        currentWidth = widths[index];
      } else {
        currentOptions.push(option);
        currentWidth = needed;
      }
    });
    if (currentOptions.length > 0) {
      result.push({ options: currentOptions, width: currentWidth });
    }
    return result;
  });

  createEffect(() => {
    const maxIndex = pages().length - 1;
    if (pageIndex() > maxIndex) setPageIndex(Math.max(0, maxIndex));
  });

  const clampedIndex = () =>
    Math.max(0, Math.min(pageIndex(), pages().length - 1));
  const canPagePrev = () => clampedIndex() > 0;
  const canPageNext = () => clampedIndex() < pages().length - 1;

  const page = (direction: 1 | -1) =>
    setPageIndex(() =>
      Math.max(0, Math.min(clampedIndex() + direction, pages().length - 1))
    );

  // --- Swipe paging -------------------------------------------------------
  // The finger drags the track live; releasing past the threshold commits
  // one page per gesture. The pointer is only captured once movement passes
  // the slop, so plain taps reach the option buttons untouched — and the
  // click trailing a real drag is eaten by a capture-phase listener.
  const [dragDelta, setDragDelta] = createSignal<number | null>(null);
  let dragPointerId: number | null = null;
  let dragStartX = 0;
  let dragRawDelta = 0;
  let dragCaptured = false;
  let suppressClick = false;

  const handlePointerDown = (event: PointerEvent) => {
    if (pages().length <= 1) return;
    if (event.pointerType === 'mouse' && event.buttons !== 1) return;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragRawDelta = 0;
    dragCaptured = false;
    setDragDelta(0);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (dragPointerId !== event.pointerId) return;
    dragRawDelta = event.clientX - dragStartX;
    if (!dragCaptured && Math.abs(dragRawDelta) > CLICK_SLOP) {
      dragCaptured = true;
      suppressClick = true;
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // synthetic pointers cannot be captured
      }
    }
    // Resist dragging past the first/last page.
    const atStart = clampedIndex() === 0 && dragRawDelta > 0;
    const atEnd = clampedIndex() === pages().length - 1 && dragRawDelta < 0;
    setDragDelta(atStart || atEnd ? dragRawDelta * 0.25 : dragRawDelta);
  };

  const endDrag = () => {
    if (dragPointerId == null) return;
    dragPointerId = null;
    setDragDelta(null);
    if (Math.abs(dragRawDelta) >= SWIPE_THRESHOLD) {
      page(dragRawDelta < 0 ? 1 : -1);
    }
    // The trailing click fires right after pointerup; let the capture
    // listener see the flag first.
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  };

  const trackOffset = () => {
    const allPages = pages();
    let offset = 0;
    for (let i = 0; i < clampedIndex(); i++) {
      offset += (allPages[i].width ?? 0) + PAGE_GAP;
    }
    return -offset + (dragDelta() ?? 0);
  };

  const currentPageWidth = () => pages()[clampedIndex()]?.width ?? null;

  // Nothing in the toolbar may take focus from the editor: Copy/Cut act on
  // the live selection, and the chevrons must leave the popup open (the
  // editor's focusout closes it). Cancelling pointerdown ought to suffice —
  // the spec then drops the compatibility mouse events, and Chrome and the
  // iOS simulator do — but a real iPhone still synthesises mousedown for the
  // tap, whose default moves focus to the button's nearest focusable
  // ancestor, the block container. Cancelling mousedown too covers that.
  const keepEditorFocus = (event: Event) => event.preventDefault();

  return (
    <div
      class="relative flex touch-pan-y flex-row items-center"
      onPointerDown={keepEditorFocus}
      onMouseDown={keepEditorFocus}
    >
      {/* Hidden measuring row: sizes every option and a chevron. Collapsed
          to a zero-size clipped box — at natural width it would extend the
          scroll parent's overflow area and make the document pannable
          sideways. The w-max rows keep the buttons at natural width inside
          the collapsed box so offsetWidth still measures correctly. */}
      <div
        class="pointer-events-none invisible absolute h-0 w-0 overflow-hidden"
        aria-hidden="true"
      >
        <div class="flex w-max flex-row items-center" ref={measureRowRef}>
          <For each={options()}>
            {(option) => (
              <Button
                size="sm"
                class={optionButtonClass}
                depth={3}
                variant="ghost"
              >
                {option.content()}
              </Button>
            )}
          </For>
        </div>
        <div class="w-max" ref={measureArrowRef}>
          <Button
            size="icon-sm"
            class={arrowButtonClass}
            depth={3}
            variant="ghost"
          >
            <CaretRightIcon class="size-4" />
          </Button>
        </div>
      </div>
      <Show when={canPagePrev()}>
        <Button
          size="icon-sm"
          class={arrowButtonClass}
          depth={3}
          variant="ghost"
          aria-label="Previous options"
          onClick={() => page(-1)}
        >
          <CaretLeftIcon class="size-4" />
        </Button>
        <div class="mx-1 w-px shrink-0 self-stretch bg-edge" />
      </Show>
      <div
        // The max-w mirrors PAGE_MARGIN and caps the not-yet-measured frame,
        // where the viewport would otherwise render the full track width.
        class="max-w-[calc(100vw-3rem)] shrink-0 overflow-hidden"
        style={{
          ...(currentPageWidth() != null
            ? { width: `${currentPageWidth()}px` }
            : {}),
          transition: dragDelta() != null ? 'none' : 'width 200ms ease-out',
        }}
        ref={(el) => {
          el.addEventListener(
            'click',
            (event) => {
              if (suppressClick) {
                event.preventDefault();
                event.stopPropagation();
              }
            },
            { capture: true }
          );
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          class="flex flex-row items-center"
          style={{
            gap: `${PAGE_GAP}px`,
            transform: `translateX(${trackOffset()}px)`,
            transition:
              dragDelta() != null ? 'none' : 'transform 200ms ease-out',
          }}
        >
          <For each={pages()}>
            {(touchPage, pageIdx) => (
              <div
                class="flex flex-none flex-row items-center"
                inert={clampedIndex() !== pageIdx()}
              >
                <For each={touchPage.options}>
                  {(option, index) => (
                    <>
                      <Show when={index() > 0}>
                        <div class="mx-1 w-px shrink-0 self-stretch bg-edge" />
                      </Show>
                      <Button
                        size="sm"
                        class={optionButtonClass}
                        depth={3}
                        variant="ghost"
                        disabled={option.disabled?.()}
                        onClick={() => option.onSelect()}
                      >
                        {option.content()}
                      </Button>
                    </>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
      <Show when={canPageNext()}>
        <div class="mx-1 w-px shrink-0 self-stretch bg-edge" />
        <Button
          size="icon-sm"
          class={arrowButtonClass}
          depth={3}
          variant="ghost"
          aria-label="More options"
          onClick={() => page(1)}
        >
          <CaretRightIcon class="size-4" />
        </Button>
      </Show>
    </div>
  );
}

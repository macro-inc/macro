import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import {
  Discussion,
  DiscussionComposer,
  DiscussionProvider,
} from '@core/comments/discussion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useUrlParams } from '@core/component/ParamsProvider';
import { useUserId } from '@core/context/user';
import { useCanComment } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import ChatIcon from '@phosphor/chat-circle.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { SpreadsheetCommentCard } from './components/SpreadsheetCommentCard';
import type { SpreadsheetCommentsCapability } from './context/spreadsheet-comments';
import { spreadsheetChatContext } from './core/chat-context';
import {
  cellAddress,
  positionFromAddress,
  selectionBounds,
} from './core/grid-selection';
import {
  SPREADSHEET_COMMENT_PARAMS,
  type SpreadsheetCommentAnchor,
  spreadsheetCommentAnchor,
} from './core/spreadsheet-comments';
import { createSpreadsheetDiscussion } from './primitives/create-spreadsheet-discussion';
import type { SpreadsheetStore } from './primitives/create-spreadsheet-store';
import { useSpreadsheetComments } from './queries/spreadsheet-comments';

/** Production wiring: shared discussions + the document annotation service. */
export function SpreadsheetComments(props: {
  documentId: string;
  store: SpreadsheetStore;
  children: (
    location: () => SpreadsheetCommentAnchor | undefined,
    comments: SpreadsheetCommentsCapability
  ) => JSX.Element;
}) {
  const userId = useUserId();
  const canComment = useCanComment();
  const params = useUrlParams(SPREADSHEET_COMMENT_PARAMS);
  const { query, api, refresh } = useSpreadsheetComments(props.documentId);
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal<SpreadsheetCommentAnchor>();
  const [location, setLocation] = createSignal<SpreadsheetCommentAnchor>();
  const [error, setError] = createSignal('');
  const threads = () => (query.isSuccess ? query.data : []);
  const request = createMemo(() => ({ id: params.commentId() }), undefined, {
    equals: false,
  });
  const target = () => request().id ?? null;
  const [card, setCard] = createSignal<{
    element: HTMLElement;
    anchor: SpreadsheetCommentAnchor;
    threadIds: string[];
    creating: boolean;
    pinned: boolean;
  }>();
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  const clearHover = () => {
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
  };
  const closeCard = () => {
    clearHover();
    setCard(undefined);
  };
  onCleanup(clearHover);
  const makeSource = (
    getAnchor: () => SpreadsheetCommentAnchor | undefined,
    operations = api
  ) =>
    createSpreadsheetDiscussion({
      threads,
      canComment,
      userId,
      anchor: getAnchor,
      targetCommentId: target,
      targetRevision: request,
      api: operations,
      refresh,
      buildLink: (id) =>
        buildSimpleEntityUrl(
          { type: 'spreadsheet', id: props.documentId },
          { comment_id: id }
        ),
    });
  const source = makeSource(anchor);
  const cardSource = makeSource(() => card()?.anchor, {
    ...api,
    create: async (body) => {
      const postingCard = card();
      const result = await api.create(body);
      if (!body.threadId && postingCard?.creating && card() === postingCard) {
        setCard({
          ...postingCard,
          creating: false,
          threadIds: [String(result.thread.threadId)],
        });
      }
      return result;
    },
  });
  const count = () =>
    source
      .threads()
      .reduce(
        (sum, thread) =>
          sum + thread.comments.filter((comment) => !comment.deletedAt).length,
        0
      );
  const navigate = (value: SpreadsheetCommentAnchor) => {
    const sheet = props.store
      .workbook()
      .find((sheet) => sheet.id === value.sheetId);
    if (!sheet) {
      setError('This comment refers to a sheet that has been deleted.');
      return;
    }
    const last = positionFromAddress(value.range.split(':').at(-1)!);
    if (!last || last.row >= sheet.layout.rowCount) {
      setError('The cells referenced by this comment are no longer available.');
      return;
    }
    setError('');
    setLocation({ ...value });
  };
  const currentAnchor = () => {
    const context = spreadsheetChatContext(
      props.store.activeSheet(),
      props.store.selection()
    );
    return {
      sheetId: context.sheetId,
      sheetName: context.sheetName,
      range: context.range,
    };
  };
  const selectAnchor = () => setAnchor(currentAnchor());
  const toggle = () => {
    if (!open()) selectAnchor();
    closeCard();
    setOpen(!open());
  };
  const anchoredThreads = createMemo(() =>
    threads().flatMap((thread) => {
      const value = spreadsheetCommentAnchor(thread.thread.metadata);
      if (
        !value ||
        thread.thread.deletedAt ||
        !thread.comments.some((comment) => !comment.deletedAt) ||
        value.sheetId !== props.store.activeSheetId()
      )
        return [];
      const [start, end = start] = value.range.split(':');
      const first = positionFromAddress(start)!;
      const last = positionFromAddress(end)!;
      const bounds = selectionBounds({ anchor: first, focus: last });
      return [{ id: String(thread.thread.threadId), anchor: value, bounds }];
    })
  );
  const markers = createMemo(
    () =>
      new Set(
        anchoredThreads().map(({ bounds }) =>
          cellAddress({ row: bounds.top, column: bounds.left })
        )
      )
  );
  const showCell = (address: string, element: HTMLElement, pinned: boolean) => {
    const position = positionFromAddress(address);
    if (!position) return;
    const hits = anchoredThreads().filter(
      ({ bounds }) =>
        position.row >= bounds.top &&
        position.row <= bounds.bottom &&
        position.column >= bounds.left &&
        position.column <= bounds.right
    );
    if (!hits.length) {
      setCard(undefined);
      return;
    }
    setCard({
      element,
      anchor: hits[0].anchor,
      threadIds: hits.map((hit) => hit.id),
      creating: false,
      pinned,
    });
  };
  const comments: SpreadsheetCommentsCapability = {
    canComment: () => canComment() && props.store.ready(),
    hasComment: (address) => markers().has(address),
    add: (element) => {
      if (!canComment()) return;
      clearHover();
      const selected = currentAnchor();
      if (!element) {
        setAnchor(selected);
        setOpen(true);
        return;
      }
      setCard({
        element,
        anchor: selected,
        threadIds: [],
        creating: true,
        pinned: true,
      });
    },
    show: (address, element) => {
      clearHover();
      showCell(address, element, true);
    },
    enter: (address, element) => {
      clearHover();
      if (card()?.pinned) return;
      hoverTimer = setTimeout(() => showCell(address, element, false), 250);
    },
    leave: () => {
      clearHover();
      if (card()?.pinned) return;
      hoverTimer = setTimeout(() => setCard(undefined), 350);
    },
  };
  // Tab changes invalidate the floating DOM anchor.
  createEffect(on(props.store.activeSheetId, closeCard, { defer: true }));
  // URL navigation is an external event, including repeated inbox opens of the same comment.
  createEffect(
    on(
      [request, () => query.isSuccess, props.store.ready],
      ([value, loaded, ready]) => {
        if (!value.id) return;
        closeCard();
        setOpen(true);
        if (!loaded || !ready) return;
        const thread = threads().find((thread) =>
          thread.comments.some(
            (comment) => String(comment.commentId) === value.id
          )
        );
        const linked = spreadsheetCommentAnchor(thread?.thread.metadata);
        if (linked) navigate(linked);
      }
    )
  );
  return (
    <DiscussionProvider source={source}>
      <SplitHeaderRight>
        <Button
          size="sm"
          variant="ghost"
          onClick={toggle}
          aria-label="Comments"
          aria-expanded={open()}
        >
          <ChatIcon class="size-4" />
          <span class="hidden sm:inline">Comments</span>
          <Show when={count()}>
            <span class="text-xs">{count()}</span>
          </Show>
        </Button>
      </SplitHeaderRight>
      <div class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          {props.children(location, comments)}
        </div>
        <Show when={open()}>
          <aside
            aria-label="Spreadsheet comments"
            class="absolute inset-0 z-30 flex flex-col bg-panel border-l border-edge-muted sm:static sm:w-96 sm:shrink-0"
          >
            <div class="flex items-center justify-between border-b border-edge-muted px-4 py-2">
              <h2 class="text-sm font-medium">Comments</h2>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Close comments"
                onClick={() => setOpen(false)}
              >
                <XIcon class="size-4" />
              </Button>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <Show when={query.isPending}>
                <p class="text-sm text-ink-muted">Loading comments…</p>
              </Show>
              <Show when={query.isError}>
                <p role="alert" class="text-sm">
                  Could not load comments.{' '}
                  <button
                    class="underline"
                    onClick={() => void query.refetch()}
                  >
                    Try again
                  </button>
                </p>
              </Show>
              <Show when={error()}>
                <p role="status" class="text-sm text-ink-muted">
                  {error()}
                </p>
              </Show>
              <Show when={query.isSuccess && !count()}>
                <p class="py-4 text-sm text-ink-muted">
                  No comments yet. Start a discussion about the selected cells.
                </p>
              </Show>
              <Discussion
                hideComposer
                threadHeader={(thread) => {
                  const linked = () =>
                    spreadsheetCommentAnchor(
                      threads().find(
                        (item) => String(item.thread.threadId) === thread.id
                      )?.thread.metadata
                    );
                  const label = () => {
                    const value = linked();
                    if (!value) return 'Workbook';
                    const sheet = props.store
                      .workbook()
                      .find((sheet) => sheet.id === value.sheetId);
                    return `${sheet?.name ?? value.sheetName} · ${value.range}${sheet ? '' : ' (deleted sheet)'}`;
                  };
                  return (
                    <button
                      class="mt-3 mb-1 rounded px-2 py-1 text-xs text-accent hover:bg-hover"
                      disabled={!linked()}
                      onClick={() => {
                        const value = linked();
                        if (value) navigate(value);
                      }}
                    >
                      {label()}
                    </button>
                  );
                }}
              />
            </div>
            <Show when={canComment()}>
              <div class="shrink-0 border-t border-edge-muted p-3">
                <div class="mb-2 flex items-center justify-between gap-2 text-xs text-ink-muted">
                  <span>
                    {anchor()
                      ? `${anchor()!.sheetName} · ${anchor()!.range}`
                      : 'Workbook comment'}
                  </span>
                  <button class="underline" onClick={selectAnchor}>
                    Use selection
                  </button>
                </div>
                <StaticMarkdownContext>
                  <DiscussionComposer />
                </StaticMarkdownContext>
              </div>
            </Show>
          </aside>
        </Show>
      </div>
      <Show when={card()}>
        {(value) => (
          <DiscussionProvider source={cardSource}>
            <SpreadsheetCommentCard
              element={value().element}
              label={`${props.store.workbook().find((sheet) => sheet.id === value().anchor.sheetId)?.name ?? value().anchor.sheetName} · ${value().anchor.range}`}
              creating={value().creating}
              threads={source
                .threads()
                .filter((thread) => value().threadIds.includes(thread.id))}
              onEnter={clearHover}
              onLeave={comments.leave}
              onInteract={() => {
                clearHover();
                if (!card()?.pinned)
                  setCard((current) =>
                    current ? { ...current, pinned: true } : current
                  );
              }}
              onClose={closeCard}
            />
          </DiscussionProvider>
        )}
      </Show>
    </DiscussionProvider>
  );
}

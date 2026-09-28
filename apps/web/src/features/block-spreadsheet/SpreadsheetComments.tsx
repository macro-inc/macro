import type { InputSnapshot } from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  useParamNavigationCount,
  useUrlParams,
} from '@core/component/ParamsProvider';
import { useUserId } from '@core/context/user';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import { scrollToRenderedTarget } from '@core/messages/scroll-to-rendered-target';
import { useCanComment } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import ChatIcon from '@phosphor/chat-circle.svg';
import XIcon from '@phosphor/x.svg';
import {
  useMessageLink,
  useMessageRootsQuery,
} from '@queries/messages/document-messages';
import {
  newMessageId,
  usePatchThreadMutation,
  useSendMessageMutation,
} from '@queries/messages/mutations';
import type { MessageListItem } from '@service-storage/messages';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
  Suspense,
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
import type { SpreadsheetStore } from './primitives/create-spreadsheet-store';
import { SpreadsheetCommentComposer } from './views/SpreadsheetCommentComposer';
import { SpreadsheetCommentThread } from './views/SpreadsheetCommentThread';

/** Production wiring for spreadsheet discussions on the shared message store. */
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
  const parent = () => ({ type: 'document' as const, id: props.documentId });
  const query = useMessageRootsQuery(parent);
  const send = useSendMessageMutation();
  const patchThread = usePatchThreadMutation();
  const linkedMessageId = () =>
    /^\d+$/.test(params.commentId() ?? '') ? undefined : params.commentId();
  const target = useMessageLink(parent, linkedMessageId);
  const navigationCount = useParamNavigationCount('comment_id');
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal<SpreadsheetCommentAnchor>();
  const [location, setLocation] = createSignal<SpreadsheetCommentAnchor>();
  const [error, setError] = createSignal('');
  const threads = () => (query.isSuccess ? query.data : []);
  const request = createMemo(() => ({
    id: linkedMessageId(),
    revision: navigationCount(),
  }));
  const [clearedTarget, setClearedTarget] =
    createSignal<ReturnType<typeof request>>();
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
  const post = async (
    value: SpreadsheetCommentAnchor,
    snapshot: InputSnapshot
  ) => {
    const senderId = userId();
    if (!senderId || !canComment())
      throw new Error('Sign in with comment access to post');
    const payload = buildPostMessageSendPayload({ snapshot });
    return send.mutateAsync({
      parent: parent(),
      senderId,
      optimisticId: newMessageId(),
      ...payload,
      message: {
        ...payload.message,
        anchor: { type: 'spreadsheet', ...value },
      },
    });
  };
  const count = () =>
    threads()
      .filter((thread) => !thread.state.deleted_at)
      .reduce(
        (sum, thread) =>
          sum + (thread.deleted_at ? 0 : 1) + thread.thread.reply_count,
        0
      );
  const renderThread = (thread: () => MessageListItem) => (
    <SpreadsheetCommentThread
      data={thread()}
      canWrite={canComment()}
      targetId={
        target.rootId() === thread().id && clearedTarget() !== request()
          ? target.messageId()
          : null
      }
      onClearTarget={() => setClearedTarget(request())}
      buildLink={(message) =>
        buildSimpleEntityUrl(
          { type: 'spreadsheet', id: props.documentId },
          { comment_id: message.id }
        )
      }
      onResolve={(resolved) =>
        patchThread.mutate({
          parent: parent(),
          rootId: thread().id,
          patch: { resolved },
        })
      }
    />
  );
  const navigate = (value: SpreadsheetCommentAnchor) => {
    const sheet = props.store
      .workbook()
      .find((sheet) => sheet.id === value.sheetId);
    if (!sheet) {
      setError('This comment refers to a sheet that has been deleted.');
      return;
    }
    const [start, end = start] = value.range.split(':');
    const first = positionFromAddress(start);
    const last = positionFromAddress(end);
    if (
      !first ||
      !last ||
      first.row >= sheet.layout.rowCount ||
      last.row >= sheet.layout.rowCount
    ) {
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
      const value = spreadsheetCommentAnchor(thread.state.anchor);
      if (
        !value ||
        thread.state.deleted_at ||
        (thread.deleted_at && thread.thread.reply_count === 0) ||
        value.sheetId !== props.store.activeSheetId()
      )
        return [];
      const [start, end = start] = value.range.split(':');
      const first = positionFromAddress(start);
      const last = positionFromAddress(end);
      if (!first || !last) return [];
      const bounds = selectionBounds({ anchor: first, focus: last });
      return [{ id: thread.id, anchor: value, bounds }];
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
  let panel: HTMLElement | undefined;
  createEffect(
    on([request, open, target.messageId], ([value, visible, messageId]) => {
      if (value.id && visible && messageId && panel) {
        onCleanup(scrollToRenderedTarget(panel, messageId));
      }
    })
  );
  let openedRequest: ReturnType<typeof request> | undefined;
  let navigatedRequest: ReturnType<typeof request> | undefined;
  // URL navigation is an external event, including repeated inbox opens of the same comment.
  createEffect(
    on(
      [
        request,
        () => query.isSuccess,
        props.store.ready,
        target.rootId,
        threads,
      ],
      ([value, loaded, ready]) => {
        if (!value.id || navigatedRequest === value) return;
        if (openedRequest !== value) {
          openedRequest = value;
          closeCard();
          setOpen(true);
          setAnchor(ready ? currentAnchor() : undefined);
        }
        if (!ready) return;
        if (!anchor()) setAnchor(currentAnchor());
        if (!loaded) return;
        const thread = threads().find(
          (thread) => thread.id === target.rootId()
        );
        if (!thread) return;
        navigatedRequest = value;
        const linked = spreadsheetCommentAnchor(thread.state.anchor);
        setAnchor(linked ?? currentAnchor());
        if (linked) navigate(linked);
      }
    )
  );
  return (
    <StaticMarkdownContext>
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
            ref={panel}
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
              <Suspense
                fallback={
                  <p class="text-sm text-ink-muted">Loading comments…</p>
                }
              >
                <For
                  each={threads()
                    .filter(
                      (thread) =>
                        !thread.state.deleted_at &&
                        spreadsheetCommentAnchor(thread.state.anchor)
                    )
                    .map((thread) => thread.id)}
                >
                  {(id) => {
                    const thread = () =>
                      threads().find((item) => item.id === id)!;
                    const linked = () =>
                      spreadsheetCommentAnchor(thread().state.anchor)!;
                    const label = () => {
                      const value = linked();
                      const sheet = props.store
                        .workbook()
                        .find((sheet) => sheet.id === value.sheetId);
                      return `${sheet?.name ?? value.sheetName} · ${value.range}${sheet ? '' : ' (deleted sheet)'}`;
                    };
                    return (
                      <>
                        <button
                          class="mt-3 mb-1 rounded px-2 py-1 text-xs text-accent hover:bg-hover"
                          onClick={() => navigate(linked())}
                        >
                          {label()}
                        </button>
                        {renderThread(thread)}
                      </>
                    );
                  }}
                </For>
                <EntityDiscussion
                  parent={parent()}
                  canWrite={canComment()}
                  link={{ type: 'spreadsheet', id: props.documentId }}
                  legacyCommentLinks={false}
                  label="Workbook discussion"
                />
              </Suspense>
            </div>
            <Show when={canComment() && anchor()}>
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
                  <Suspense>
                    <SpreadsheetCommentComposer
                      parent={parent()}
                      onSend={async (snapshot) => {
                        const value = anchor();
                        if (!value) throw new Error('Select cells to comment');
                        await post(value, snapshot);
                      }}
                    />
                  </Suspense>
                </StaticMarkdownContext>
              </div>
            </Show>
          </aside>
        </Show>
      </div>
      <Show when={card()}>
        {(value) => (
          <Suspense>
            <SpreadsheetCommentCard
              element={value().element}
              label={`${props.store.workbook().find((sheet) => sheet.id === value().anchor.sheetId)?.name ?? value().anchor.sheetName} · ${value().anchor.range}`}
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
            >
              <For
                each={threads()
                  .filter(
                    (thread) =>
                      !thread.state.deleted_at &&
                      value().threadIds.includes(thread.id)
                  )
                  .map((thread) => thread.id)}
              >
                {(id) =>
                  renderThread(
                    () => threads().find((thread) => thread.id === id)!
                  )
                }
              </For>
              <Show when={value().creating && canComment()}>
                <SpreadsheetCommentComposer
                  parent={parent()}
                  autofocus
                  onSend={async (snapshot) => {
                    const postingCard = card();
                    if (!postingCard) return;
                    const message = await post(postingCard.anchor, snapshot);
                    if (card() === postingCard)
                      setCard({
                        ...postingCard,
                        creating: false,
                        threadIds: [message.id],
                      });
                  }}
                />
              </Show>
            </SpreadsheetCommentCard>
          </Suspense>
        )}
      </Show>
    </StaticMarkdownContext>
  );
}

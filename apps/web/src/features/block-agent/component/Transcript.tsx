/** Agent messages on the channel's end-anchored TanStack scroll surface. */
import { ScrollToBottomOverlay } from '@channel/Channel/ScrollToBottomOverlay';
import {
  ThreadList,
  type ThreadListNavigation,
  type ThreadListScrollState,
} from '@channel/Channel/ThreadList';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import type { AgentMessageTarget } from '../core/search-location';
import { Message } from './AgentMessage';
import { ReplyToSelection } from './ReplyToSelection';

export function Transcript(props: { searchTarget?: AgentMessageTarget }) {
  const { messages, quoteSelection, sessionId } = useAgentSession();
  const initialTarget = props.searchTarget;
  const initialSessionId = sessionId();
  const splitPanel = useSplitPanel();
  const [transcriptEl, setTranscriptEl] = createSignal<HTMLDivElement>();
  const [scrollState, setScrollState] = createSignal<ThreadListScrollState>();
  const [navigation, setNavigation] = createSignal<ThreadListNavigation>();
  const [highlightedId, setHighlightedId] = createSignal<string>();

  // Object identity and array positions can change as the live fold reconciles.
  const messageById = createMemo(
    () =>
      new Map(
        messages().map((message) => [
          `${message.agentSessionId}:${message.turn}:${message.author.kind}`,
          message,
        ])
      )
  );
  const keys = createMemo(() => [...messageById().keys()]);
  let positionedTarget: AgentMessageTarget | undefined;
  // Navigation is an external effect. Wait for both log hydration and the
  // virtual list's layout; subsequent live folds must not repeat the jump.
  createEffect(
    on(
      [() => props.searchTarget, messageById, navigation, scrollState],
      ([target, byId, handle, state]) => {
        if (
          !target ||
          target === positionedTarget ||
          !handle ||
          !state?.didInitialScroll
        )
          return;
        const entry = [...byId].find(
          ([, message]) =>
            message.turn === target.messageTurn &&
            message.author.kind === target.author
        );
        if (!entry) return;
        // The ready notification can run within initial layout, before its
        // scroll-to-latest finishes. Navigate after that layout has committed.
        const frame = requestAnimationFrame(() => {
          if (!handle.scrollToMessage(entry[0])) return;
          positionedTarget = target;
          setHighlightedId(entry[0]);
        });
        onCleanup(() => cancelAnimationFrame(frame));
      }
    )
  );
  // Insets belong in virtual measurements, not CSS padding outside the sizer.
  // ThreadList preserves the end pin across keyboard/viewport and inset resizes.
  const insets = () =>
    isTouchDevice()
      ? {
          start: splitPanel?.contentOffsetTop() ?? 0,
          end: FloatRegions.hostHeight(),
        }
      : { start: 0, end: 0 };

  return (
    <div class="relative flex-1 min-h-0" ref={setTranscriptEl}>
      <ThreadList
        keys={keys}
        initialPosition={
          initialTarget && initialSessionId
            ? {
                type: 'element',
                id: `${initialSessionId}:${initialTarget.messageTurn}:${initialTarget.author}`,
              }
            : { type: 'latest' }
        }
        insets={insets()}
        targetId={highlightedId()}
        onUserNavigation={() => setHighlightedId(undefined)}
        onReady={(handle) => {
          setNavigation(handle);
          return () => {
            setNavigation(undefined);
          };
        }}
        onScroll={(state) => setScrollState(state)}
      >
        {({ id }) => (
          <Show when={messageById().get(id)}>
            {(message) => (
              <div
                class="macro-message-width mx-auto px-4 pb-4 min-w-0 rounded-lg"
                classList={{ 'bg-accent/10': highlightedId() === id }}
                data-search-target={highlightedId() === id ? 'true' : undefined}
              >
                <Message message={message()} />
              </div>
            )}
          </Show>
        )}
      </ThreadList>
      <ScrollToBottomOverlay
        scrollState={scrollState}
        onScrollToBottom={() => {
          setHighlightedId(undefined);
          navigation()?.scrollToLatest();
        }}
        class="touch:top-[calc(var(--mobile-content-inset-top,0)+1rem)]"
      />
      <ReplyToSelection container={transcriptEl()} onReply={quoteSelection} />
    </div>
  );
}

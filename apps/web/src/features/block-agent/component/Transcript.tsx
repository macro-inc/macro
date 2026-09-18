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
import { match } from 'ts-pattern';
import { useAgentSession } from '../context/AgentSessionContext';
import type { AgentMessageTarget } from '../core/search-location';
import { isLiveTurn, liveTurnMessage } from '../state/live-turn';
import { WorkingLine } from '../ui/WorkingLine';
import { Message } from './AgentMessage';
import { ReplyToSelection } from './ReplyToSelection';

export function Transcript(props: { searchTarget?: AgentMessageTarget }) {
  const { messages, quoteSelection, sessionId, turn } = useAgentSession();
  // At most one turn runs, and the fold's `turn` is the one word on whether
  // it does - so which message shimmers is decided here, once, not by each
  // message from its own `stop` (see `state/live-turn`). A speculated stop
  // reads as `stopping`, which settles the live message before the log
  // closes it.
  const working = () => {
    const state = turn();
    return state === 'starting' || state === 'running' || state === 'blocked';
  };
  const liveTurn = () => liveTurnMessage(messages(), working());
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
  // The turn is open and the agent has said nothing yet: the newest message
  // is the user's, so no agent row exists to carry the working line. One
  // extra row at the tail says the wait is work, not a stall - a prompt still
  // on the wire (`starting`) included.
  const workingKey = () => `${sessionId() ?? ''}:working`;
  const showsWorking = createMemo(() => {
    const state = turn();
    if (state !== 'starting' && state !== 'running') return false;
    const last = messages().at(-1);
    return last?.author.kind === 'user';
  });
  // What the wait is: the prompt still on the wire, or the agent at work.
  const workingLabel = () =>
    match(turn())
      .with('starting', () => 'Sending')
      .otherwise(() => 'Working');
  const keys = createMemo(() => [
    ...messageById().keys(),
    ...(showsWorking() ? [workingKey()] : []),
  ]);
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
          <Show
            when={id !== workingKey()}
            fallback={
              <div class="macro-message-width mx-auto px-4 pb-4 min-w-0">
                <WorkingLine label={workingLabel()} />
              </div>
            }
          >
            <Show when={messageById().get(id)}>
              {(message) => (
                <div
                  class="macro-message-width mx-auto px-4 pb-4 min-w-0 rounded-lg"
                  classList={{ 'bg-accent/10': highlightedId() === id }}
                  data-search-target={
                    highlightedId() === id ? 'true' : undefined
                  }
                >
                  <Message
                    message={message()}
                    inFlight={isLiveTurn(message(), liveTurn())}
                  />
                </div>
              )}
            </Show>
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

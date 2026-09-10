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
import { createMemo, createSignal, Show } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import { needsTrailingWorkingLine } from '../state/shows-working-line';
import { WorkingLine } from '../ui';
import { Message } from './AgentMessage';
import { ReplyToSelection } from './ReplyToSelection';

/** Synthetic transcript row for the wait before the first reply part. */
const TRAILING_WORKING_KEY = '__working__';

export function Transcript() {
  const { blockedOnUser, composer, messages, quoteSelection, working } =
    useAgentSession();
  const splitPanel = useSplitPanel();
  const [transcriptEl, setTranscriptEl] = createSignal<HTMLDivElement>();
  const [scrollState, setScrollState] = createSignal<ThreadListScrollState>();
  let navigation: ThreadListNavigation | undefined;

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
  const trailingWorking = () =>
    needsTrailingWorkingLine({
      messages: messages(),
      working: working(),
      sending: composer.sending(),
      blockedOnUser: blockedOnUser(),
    });
  const keys = createMemo(() => {
    const ids = [...messageById().keys()];
    return trailingWorking() ? [...ids, TRAILING_WORKING_KEY] : ids;
  });
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
        initialPosition={{ type: 'latest' }}
        insets={insets()}
        onReady={(handle) => {
          navigation = handle;
          return () => {
            navigation = undefined;
          };
        }}
        onScroll={(state) => setScrollState(state)}
      >
        {({ id }) => (
          <Show
            when={id !== TRAILING_WORKING_KEY}
            fallback={
              <div class="macro-message-width mx-auto px-4 pb-4 min-w-0">
                <WorkingLine />
              </div>
            }
          >
            <Show when={messageById().get(id)}>
              {(message) => (
                <div class="macro-message-width mx-auto px-4 pb-4 min-w-0">
                  <Message message={message()} />
                </div>
              )}
            </Show>
          </Show>
        )}
      </ThreadList>
      <ScrollToBottomOverlay
        scrollState={scrollState}
        onScrollToBottom={() => navigation?.scrollToLatest()}
        class="touch:top-[calc(var(--mobile-content-inset-top,0)+1rem)]"
      />
      <ReplyToSelection container={transcriptEl()} onReply={quoteSelection} />
    </div>
  );
}

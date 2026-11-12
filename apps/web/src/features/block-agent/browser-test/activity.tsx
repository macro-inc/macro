// Replays a long agent turn through the session transcript's message view:
// prose, a run of 74 steps across programs, calls and thoughts, then the
// answer. `?speed=` divides every delay; `?summary=1` also publishes the
// session summarizer's line for each stretch, as the server would.
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { UserMessageBubble } from '@ui';
import { err, ok } from 'neverthrow';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { Message } from '../component/AgentMessage';
import { PROMPT, playTurn, savedExecution, turn } from './activity-turn';
import '@fontsource-variable/inter';
import '../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme('Macro Dark');

// The harness answers from the replay's saved programs.
Object.assign(agentHarnessServiceClient, {
  getCodeExecution: async (_session: string, executionId: string) => {
    const record = savedExecution(executionId);
    return record
      ? ok(record)
      : err([
          Object.assign(new Error('No such execution'), { code: 'NOT_FOUND' }),
        ]);
  },
});

const params = new URLSearchParams(location.search);
const speed = Number(params.get('speed') ?? 1) || 1;
const summarize = params.get('summary') === '1';
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Turn() {
  let section: HTMLElement | undefined;
  onMount(() => {
    // Follow the turn's tail while it runs, as the transcript does.
    const observer = new ResizeObserver(() => {
      if (turn.inFlight()) window.scrollTo(0, document.body.scrollHeight);
    });
    if (section) observer.observe(section);
  });
  return (
    <section ref={section} aria-label="Agent session" class="min-w-0 py-6">
      <div class="macro-message-width mx-auto px-4 pb-4 min-w-0">
        {/* The prompt as the transcript's bubble shows it, without the
            app's user and layout contexts a prompt message reads. */}
        <div class="flex w-full flex-col items-end">
          <UserMessageBubble>
            <p class="whitespace-pre-wrap">{PROMPT}</p>
          </UserMessageBubble>
        </div>
      </div>
      <div class="macro-message-width mx-auto px-4 pb-4 min-w-0">
        <Message message={turn.message()} inFlight={turn.inFlight()} />
      </div>
      <div hidden data-turn={turn.done() ? 'done' : 'live'} />
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Turn />
    </QueryClientProvider>
  ),
  root
);
await playTurn({ speed, summarize });

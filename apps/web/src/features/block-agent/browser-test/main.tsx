import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal, For } from 'solid-js';
import '../../../index.css';
import type {
  FoldedMessage,
  SessionNotification,
} from '@service-agent-fold/generated/types';
import { render } from 'solid-js/web';
import { Message } from '../component/AgentMessage';
import { SessionEventRow } from '../components/session-event-row';
import { PresentedReviewPart } from '../views/PresentedReviewPart';
import {
  receiveDecision,
  receiveNoop,
  receiveText,
  reviewId,
  session,
} from './session';

// The fixture uses the same touch variant switch as the app entry point.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const eventBase = {
  id: 'event',
  subjectId: reviewId,
  createdAt: new Date().toISOString(),
  turn: 1,
  actionId: 'action',
  systemTurn: true,
};
const events: SessionNotification[] = [
  {
    ...eventBase,
    kind: 'app.connected',
    payload: {
      app: 'Notion workspace with a very long name for mobile truncation verification',
    },
  },
  {
    ...eventBase,
    kind: 'review.decided',
    payload: {
      by: session.userId(),
      via: 'card',
      outcome: 'approved',
      items: [{ id: '1', status: 'submitting', edited: false }],
    },
  },
  {
    ...eventBase,
    kind: 'review.settled',
    payload: {
      by: session.userId(),
      via: 'card',
      outcome: 'partial',
      items: [
        {
          id: '1',
          status: 'unknown',
          edited: false,
          error: 'Provider rejected',
        },
      ],
    },
  },
];
// The turn a background task's report wakes the agent for, as the fold
// gives it: reports first, then the reply.
const taskReply: FoldedMessage = {
  agentSessionId: session.sessionId(),
  requestId: null,
  pending: false,
  postedAt: null,
  segments: [],
  phase: null,
  turn: 2,
  author: { kind: 'agent' },
  stop: { kind: 'end_turn' },
  parts: [
    {
      kind: 'task_notification',
      status: 'completed',
      summary:
        'Background command "Run affected tests in nix shell" completed (exit code 0)',
      event: null,
    },
    {
      kind: 'task_notification',
      status: 'failed',
      summary: 'Background command "cargo test" failed with exit code 101',
      event: null,
    },
    {
      kind: 'task_notification',
      status: 'completed',
      summary: 'Agent "Research document removal" finished',
      event: null,
    },
    {
      kind: 'task_notification',
      status: null,
      summary: 'Monitor event: "PR checks"',
      event: 'check: fail',
    },
    { kind: 'text', text: 'The tests passed; one check is still failing.' },
  ],
};
const [openedReview, setOpenedReview] = createSignal('');
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <main>
      <h1>Agent session</h1>
      <section aria-label="Session events" class="min-w-0">
        <For each={events}>
          {(event) => (
            <SessionEventRow
              event={event}
              viewerId={session.userId()}
              onOpenReview={(subject) => {
                setOpenedReview(subject);
                document.getElementById(`review-${subject}`)?.scrollIntoView();
              }}
            />
          )}
        </For>
      </section>
      <section aria-label="Task reports" class="min-w-0">
        <Message message={taskReply} inFlight={false} />
      </section>
      <output aria-label="Opened review">{openedReview()}</output>
      <div id={`review-${reviewId}`}>
        <PresentedReviewPart
          sessionId={session.sessionId()}
          reviewId={reviewId}
        />
      </div>
      <For each={session.messages()}>
        {(message) => (
          <p data-turn={message.turn}>
            <For each={message.parts}>
              {(part) => (part.kind === 'text' ? part.text : '')}
            </For>
          </p>
        )}
      </For>
      <nav>
        <button type="button" onClick={() => receiveText(0)}>
          Busy output
        </button>
        <button type="button" onClick={receiveDecision}>
          Receive decision
        </button>
        <button type="button" onClick={() => receiveText(1)}>
          Agent reply
        </button>
        <button type="button" onClick={receiveNoop}>
          Silent completion
        </button>
      </nav>
    </main>
  ),
  root
);

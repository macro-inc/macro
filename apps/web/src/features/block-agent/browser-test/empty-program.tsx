// Settled agent replies with a program that failed before naming a step: in
// the session transcript alone in its run and beside other steps, and in a
// channel reply. The harness answers with the saved records.
import { AgentActivity } from '@app/features/agent-activity/agent-activity';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type {
  ActivityRow_Serialize as ActivityRow,
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type { ExecutionRecord } from '@service-agent-harness/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { Message } from '../component/AgentMessage';
import '@fontsource-variable/inter';
import '../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme('Macro Dark');

const SESSION_ID = '019a0000-0000-7000-8000-0000000000b1';
const FAILED = '019a0000-0000-7000-8000-0000000000f1';
const FAILED_AGAIN = '019a0000-0000-7000-8000-0000000000f2';
const FOUND = '019a0000-0000-7000-8000-0000000000f3';
const ERROR = 'ReferenceError: macro.mail is not defined';

const records = new Map<string, ExecutionRecord>([
  [
    FAILED,
    {
      executionId: FAILED,
      source: 'return await macro.mail.search("invoice");',
      status: 'failed',
      error: ERROR,
      calls: [],
      activity: [],
    },
  ],
  [
    FAILED_AGAIN,
    {
      executionId: FAILED_AGAIN,
      source: 'return await macro.mail.search("renewal");',
      status: 'failed',
      error: ERROR,
      calls: [],
      activity: [],
    },
  ],
  [
    FOUND,
    {
      executionId: FOUND,
      source: 'return await macro.email.search("renewal");',
      status: 'succeeded',
      calls: [],
      activity: [
        { id: 0, label: 'Search email', status: 'completed' },
        { id: 1, label: 'Read email thread', status: 'completed' },
      ],
    },
  ],
]);

Object.assign(agentHarnessServiceClient, {
  getCodeExecution: async (_session: string, executionId: string) => {
    const record = records.get(executionId);
    return record
      ? ok(structuredClone(record))
      : err([
          Object.assign(new Error('No such execution'), { code: 'NOT_FOUND' }),
        ]);
  },
});

function program(id: string, executionId: string): MessagePart {
  const record = records.get(executionId);
  if (!record) throw new Error(`No record ${executionId}`);
  const failed = record.status === 'failed';
  return {
    kind: 'tool_use',
    id,
    name: { kind: 'mcp', server: 'macro_internal', tool: 'ExecuteCode' },
    status: failed ? 'failed' : 'completed',
    detail: {
      kind: 'macro',
      input: { source: record.source, execution_id: executionId },
      output: {
        executionId,
        status: record.status,
        activity: record.activity,
        ...(failed ? { error: ERROR } : {}),
      },
      error: failed ? ERROR : null,
    },
  };
}

const text = (value: string): MessagePart => ({ kind: 'text', text: value });
const row = (
  id: string,
  label: string,
  status: ActivityRow['status'] = 'completed'
): ActivityRow => ({ id, label, detail: null, status, card: null });

function reply(
  key: string,
  parts: MessagePart[],
  rows: ActivityRow[]
): FoldedMessage {
  return {
    agentSessionId: SESSION_ID,
    key,
    turn: 1,
    author: { kind: 'agent' },
    requestId: null,
    parts,
    stop: { kind: 'end_turn' },
    pending: false,
    segments: [
      {
        index: 0,
        kind: 'activity',
        start: 0,
        end: parts.length - 1,
        sealed: true,
        rows,
      },
      {
        index: 1,
        kind: 'prose',
        start: parts.length - 1,
        end: parts.length,
        sealed: true,
        rows: [],
      },
    ],
    phase: null,
    postedAt: null,
  };
}

const ALONE = reply(
  '1:agent',
  [
    program('alone', FAILED),
    text("I couldn't search your mail just now; I'll try again."),
  ],
  [row('alone', 'A step failed', 'failed')]
);

const MIXED = reply(
  '2:agent',
  [
    program('first', FAILED_AGAIN),
    program('second', FOUND),
    text('Found the renewal thread.'),
  ],
  [
    row('first', 'A step failed', 'failed'),
    row('second:0', 'Search email'),
    row('second:1', 'Read email thread'),
  ]
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <main class="macro-message-width mx-auto flex min-w-0 flex-col gap-8 px-4 py-6">
        <section aria-label="Program alone" class="min-w-0">
          <Message message={ALONE} inFlight={false} />
        </section>
        <section aria-label="Program beside steps" class="min-w-0">
          <Message message={MIXED} inFlight={false} />
        </section>
        <section aria-label="Channel reply" class="min-w-0 text-sm">
          <AgentActivity
            agentSessionId="session"
            turn={1}
            segment={0}
            sealed
            rows={[{ id: 'alone', label: 'A step failed', status: 'failed' }]}
          />
          <p>I couldn't search your mail just now; I'll try again.</p>
        </section>
      </main>
    </QueryClientProvider>
  ),
  root
);

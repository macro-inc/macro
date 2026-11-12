/**
 * A long agent turn replayed over time, as the session fold and the harness
 * would report it: prose, a run of 74 steps across programs, direct calls and
 * thoughts (one program timing out, one operation failing), then the answer.
 * The transcript under test reads it through the same props and queries as
 * the app.
 */

import { publishSessionActivity } from '@core/agent-session/session-activity';
import type {
  ActivityRow_Serialize as ActivityRow,
  FoldedMessage,
  MessagePart,
  Segment_Serialize as Segment,
} from '@service-agent-fold/generated/types';
import type {
  ExecutionActivity,
  ExecutionRecord,
} from '@service-agent-harness/generated/schemas';
import { createStore, reconcile } from 'solid-js/store';

export const SESSION_ID = '019a0000-0000-7000-8000-0000000000a1';

/** One SDK operation a program runs: its running and finished wording. */
type Operation = {
  running: string;
  done: string;
  ms: number;
  /** Runs alongside the operations next to it that also set this. */
  parallel?: boolean;
  fails?: boolean;
};

type Beat =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'lookup' }
  | {
      kind: 'program';
      operations: Operation[];
      /** The session summarizer's line for this stretch of the run. */
      line?: string;
      /** Ends without operations, timed out after this long. */
      timesOutAfter?: number;
    }
  | {
      kind: 'call';
      tool: string;
      running: string;
      done: string;
      detail: string;
      ms: number;
      line?: string;
    };

const op = (
  running: string,
  done: string,
  ms = 450,
  extra?: Pick<Operation, 'parallel' | 'fails'>
): Operation => ({ running, done, ms, ...extra });
const together = (count: number, running: string, done: string, ms: number) =>
  Array.from({ length: count }, () =>
    op(running, done, ms, { parallel: true })
  );

export const PROMPT =
  "Please forward the overdue invoice from our hosting vendor to Sam. Also draft me an email to our CI provider asking for a call to renegotiate our plan, since we're running far more CI than we used to.";

const BEATS: Beat[] = [
  { kind: 'text', text: "I'll take care of that." },
  {
    kind: 'program',
    operations: [op('Searching emails', 'Searched emails', 700)],
  },
  { kind: 'text', text: 'Let me gather the invoice and contacts first.' },
  { kind: 'lookup' },
  {
    kind: 'program',
    line: 'Looking for the overdue invoice…',
    operations: [
      op('Searching emails', 'Searched emails', 500),
      ...together(3, 'Reading an email thread', 'Read an email thread', 1800),
      op('Listing attachments', 'Listed attachments', 400),
      op('Reading an attachment', 'Read an attachment', 700),
      op('Searching emails', 'Searched emails'),
      op('Reading an email thread', 'Read an email thread'),
      op('Searching documents', 'Searched documents'),
      op('Reading a document', 'Read a document'),
    ],
  },
  {
    kind: 'call',
    tool: 'ContentSearch',
    running: 'Searching documents',
    done: 'Searched documents',
    detail: 'hosting invoice',
    ms: 800,
  },
  {
    kind: 'program',
    line: "Finding Sam's contact details…",
    operations: [
      op('Searching people', 'Searched people'),
      ...together(2, 'Reading a profile', 'Read a profile', 1200),
      op('Searching contacts', 'Searched contacts', 400),
      op('Reading a contact', 'Read a contact', 400),
      op('Searching channels', 'Searched channels', 400),
      ...together(2, 'Reading a channel thread', 'Read a channel thread', 1200),
    ],
  },
  {
    kind: 'thought',
    text: 'The overdue invoice is in a billing thread from the hosting vendor, with the PDF attached, and Sam is on the finance team. Next I need our CI usage, so the second email has real numbers.',
  },
  {
    kind: 'program',
    line: 'Pulling CI usage from your workspace…',
    operations: [],
    timesOutAfter: 3500,
  },
  {
    kind: 'thought',
    text: 'That query ran too long. I will read the usage reports directly instead.',
  },
  {
    kind: 'program',
    line: 'Reading CI usage reports…',
    operations: [
      op('Searching documents', 'Searched documents', 400),
      ...together(4, 'Reading a document', 'Read a document', 2400),
      op('Searching emails', 'Searched emails', 400),
      ...together(3, 'Reading an email thread', 'Read an email thread', 1800),
      ...together(2, 'Opening a link', 'Opened a link', 1400),
      op('Searching channels', 'Searched channels', 400),
      op('Reading a channel thread', 'Read a channel thread', 350),
      op('Reading a channel thread', 'Read a channel thread', 350),
      op('Reading a channel thread', 'Read a channel thread', 350),
      op('Reading a spreadsheet', 'Read a spreadsheet', 600),
    ],
  },
  {
    kind: 'call',
    tool: 'ReadChannelMessages',
    running: 'Reading messages in',
    done: 'Read messages in',
    detail: '#build-infra',
    ms: 800,
    line: 'Reading the build channel…',
  },
  {
    kind: 'call',
    tool: 'ContentSearch',
    running: 'Searching documents',
    done: 'Searched documents',
    detail: 'CI plan',
    ms: 800,
  },
  {
    kind: 'call',
    tool: 'ReadContent',
    running: 'Reading',
    done: 'Read',
    detail: 'CI vendor contract',
    ms: 800,
  },
  {
    kind: 'thought',
    text: 'Usage roughly doubled over the last two months, and the contract renews next quarter. That is enough to write both emails.',
  },
  {
    kind: 'program',
    line: 'Checking the CI plan and account contacts…',
    operations: [
      op('Searching contacts', 'Searched contacts', 400),
      ...together(2, 'Reading a contact', 'Read a contact', 1200),
      op('Searching emails', 'Searched emails', 400),
      op('Reading an email thread', 'Read an email thread', 350),
      op('Reading an email thread', 'Read an email thread', 350),
      op('Reading an email thread', 'Read an email thread', 350),
      op('Reading an email thread', 'Read an email thread', 350),
      op('Searching documents', 'Searched documents', 400),
      ...together(2, 'Reading a document', 'Read a document', 1200),
      op('Reading a calendar', 'Read a calendar', 400),
      op('Listing events', 'Listed events', 400),
      op('Reading an event', 'Read an event', 400),
    ],
  },
  {
    kind: 'program',
    line: 'Drafting the forward to Sam…',
    operations: [
      op('Reading an email thread', 'Read an email thread', 400),
      op('Creating a draft', 'Created a draft', 600),
      op('Attaching a file', 'Attached a file', 600),
      op('Reading a draft', 'Read a draft', 400),
      op('Updating a draft', 'Update a draft failed', 700, { fails: true }),
      op('Reading an email thread', 'Read an email thread', 400),
      op('Searching emails', 'Searched emails', 400),
      op('Reading a draft', 'Read a draft', 400),
    ],
  },
  {
    kind: 'thought',
    text: 'One update failed because the thread moved. I will recreate that draft rather than retry the update.',
  },
  {
    kind: 'program',
    line: 'Drafting both emails…',
    operations: [
      op('Creating a draft', 'Created a draft', 600),
      op('Attaching a file', 'Attached a file', 600),
      op('Reading a draft', 'Read a draft', 400),
      op('Creating a draft', 'Created a draft', 600),
      op('Reading a draft', 'Read a draft', 400),
      op('Searching contacts', 'Searched contacts', 400),
      op('Reading a contact', 'Read a contact', 400),
    ],
  },
  {
    kind: 'program',
    operations: [op('Reading a draft', 'Read a draft', 500)],
  },
  {
    kind: 'program',
    line: 'Checking the drafts…',
    operations: [
      ...together(2, 'Reading a draft', 'Read a draft', 900),
      op('Searching emails', 'Searched emails', 400),
      op('Reading an email thread', 'Read an email thread', 400),
      op('Listing drafts', 'Listed drafts', 400),
    ],
  },
  {
    kind: 'text',
    text: "I drafted both emails. They're on the cards for you to review, and nothing has been sent.\n\n- **Forward to Sam**: the vendor's overdue invoice, with the PDF attached.\n- **CI plan**: a short note asking for a call, citing usage that roughly doubled over two months.",
  },
];

/** What the harness has saved for each program, by execution ID. */
const records = new Map<string, ExecutionRecord>();

/** The harness answer for one execution, as `getCodeExecution` gives it. */
export function savedExecution(executionId: string) {
  const record = records.get(executionId);
  return record ? structuredClone(record) : undefined;
}

type Model = { parts: MessagePart[]; rows: Map<string, ActivityRow[]> };

const [state, setState] = createStore<{
  message: FoldedMessage;
  inFlight: boolean;
  done: boolean;
}>({
  message: reply({ parts: [], rows: new Map() }, null),
  inFlight: false,
  done: false,
});

export const turn = {
  message: () => state.message,
  inFlight: () => state.inFlight,
  done: () => state.done,
};

/** The fold's segments: prose for text, one activity segment per run between. */
function segments(model: Model, open: boolean): Segment[] {
  const result: Segment[] = [];
  model.parts.forEach((part, index) => {
    const prose = part.kind === 'text';
    const last = result.at(-1);
    if (!prose && last?.kind === 'activity' && last.end === index) {
      last.end = index + 1;
      last.rows.push(...rowsOf(model, part));
      return;
    }
    result.push({
      index: result.length,
      kind: prose ? 'prose' : 'activity',
      start: index,
      end: index + 1,
      sealed: true,
      rows: prose ? [] : rowsOf(model, part),
    });
  });
  const tail = result.at(-1);
  if (tail && open) tail.sealed = false;
  return result;
}

function rowsOf(model: Model, part: MessagePart): ActivityRow[] {
  return part.kind === 'tool_use' ? (model.rows.get(part.id) ?? []) : [];
}

function reply(model: Model, stop: FoldedMessage['stop']): FoldedMessage {
  return {
    agentSessionId: SESSION_ID,
    key: '1:agent',
    turn: 1,
    author: { kind: 'agent' },
    requestId: null,
    parts: model.parts,
    stop,
    pending: false,
    segments: segments(model, stop === null),
    phase: null,
    postedAt: null,
  };
}

const executionId = (n: number) =>
  `019a0000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

/**
 * Replays the turn. `speed` divides every delay; `summarize` publishes the
 * session summarizer's line for each stretch, as the server would.
 */
export async function playTurn(options: { speed: number; summarize: boolean }) {
  const model: Model = { parts: [], rows: new Map() };
  const commit = () =>
    setState('message', reconcile(structuredClone(reply(model, null))));
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms / options.speed));
  const update = (index: number, change: Partial<MessagePart>) => {
    model.parts[index] = { ...model.parts[index], ...change } as MessagePart;
  };
  let calls = 0;

  setState({ inFlight: true, done: false });
  commit();
  await sleep(900);
  for (const beat of BEATS) {
    switch (beat.kind) {
      case 'text': {
        const index = model.parts.push({ kind: 'text', text: '' }) - 1;
        const words = beat.text.split(/(?<= )/);
        for (const [count] of words.entries()) {
          update(index, { text: words.slice(0, count + 1).join('') });
          commit();
          await sleep(35);
        }
        break;
      }
      case 'thought': {
        const index = model.parts.push({ kind: 'thought', text: '' }) - 1;
        const words = beat.text.split(/(?<= )/);
        for (const [count] of words.entries()) {
          update(index, { text: words.slice(0, count + 1).join('') });
          commit();
          await sleep(70);
        }
        break;
      }
      case 'lookup': {
        calls += 1;
        const id = `lookup-${calls}`;
        const index =
          model.parts.push({
            kind: 'tool_use',
            id,
            name: {
              kind: 'mcp',
              server: 'macro_internal',
              tool: 'SearchTools',
            },
            status: 'running',
            detail: {
              kind: 'macro',
              input: { query: 'email drafts' },
              output: null,
              error: null,
            },
          }) - 1;
        commit();
        await sleep(400);
        update(index, { status: 'completed' });
        commit();
        break;
      }
      case 'call': {
        calls += 1;
        const id = `call-${calls}`;
        if (beat.line && options.summarize)
          publishSessionActivity(SESSION_ID, beat.line);
        const index =
          model.parts.push({
            kind: 'tool_use',
            id,
            name: { kind: 'mcp', server: 'macro', tool: beat.tool },
            status: 'running',
            detail: {
              kind: 'macro',
              input: { query: beat.detail },
              output: null,
              error: null,
            },
          }) - 1;
        model.rows.set(id, [
          {
            id,
            label: beat.running,
            detail: beat.detail,
            status: 'running',
            card: null,
          },
        ]);
        commit();
        await sleep(beat.ms);
        update(index, {
          status: 'completed',
          detail: {
            kind: 'macro',
            input: { query: beat.detail },
            output: { results: [] },
            error: null,
          },
        });
        model.rows.set(id, [
          {
            id,
            label: beat.done,
            detail: beat.detail,
            status: 'completed',
            card: null,
          },
        ]);
        commit();
        break;
      }
      case 'program': {
        calls += 1;
        await runProgram(beat, calls);
        break;
      }
    }
    await sleep(300);
  }
  if (options.summarize) publishSessionActivity(SESSION_ID, null);
  setState(
    'message',
    reconcile(structuredClone(reply(model, { kind: 'end_turn' })))
  );
  setState({ inFlight: false, done: true });

  async function runProgram(
    beat: Extract<Beat, { kind: 'program' }>,
    n: number
  ) {
    const id = `call-${n}`;
    const execution = executionId(n);
    const source = `// program ${n}\nconst found = await macro.search(${JSON.stringify(beat.line ?? 'drafts')});\nreturn found;`;
    const input = { source, execution_id: execution };
    if (beat.line && options.summarize)
      publishSessionActivity(SESSION_ID, beat.line);
    // The model streams the program's arguments first.
    const index =
      model.parts.push({
        kind: 'tool_use',
        id,
        name: { kind: 'mcp', server: 'macro_internal', tool: 'ExecuteCode' },
        status: 'pending',
        detail: { kind: 'macro', input: {}, output: null, error: null },
      }) - 1;
    commit();
    await sleep(400);
    const activity: ExecutionActivity[] = [];
    const save = (change: Partial<ExecutionRecord>) =>
      records.set(execution, {
        executionId: execution,
        source,
        calls: [],
        status: 'running',
        activity: structuredClone(activity),
        ...change,
      });
    save({});
    update(index, {
      status: 'running',
      detail: { kind: 'macro', input, output: null, error: null },
    });
    model.rows.set(id, [
      {
        id,
        label: 'Working in your workspace',
        detail: null,
        status: 'running',
        card: null,
      },
    ]);
    commit();

    if (beat.timesOutAfter !== undefined) {
      await sleep(beat.timesOutAfter);
      const error = 'Execution timed out after 60 s';
      save({ status: 'timed_out', error });
      update(index, {
        status: 'failed',
        detail: {
          kind: 'macro',
          input,
          output: {
            executionId: execution,
            status: 'timed_out',
            activity: [],
            error,
          },
          error,
        },
      });
      model.rows.set(id, [
        {
          id,
          label: 'Workspace activity',
          detail: null,
          status: 'failed',
          card: null,
        },
      ]);
      commit();
      return;
    }

    let next = 0;
    while (next < beat.operations.length) {
      // A batch the program awaits together, else the next operation alone.
      const first = beat.operations[next];
      let end = next + 1;
      while (first.parallel && beat.operations[end]?.parallel) end += 1;
      const batch = beat.operations
        .slice(next, end)
        .map((operation, offset) => ({
          operation,
          entry: {
            id: next + offset,
            label: operation.running,
            status: 'running' as const,
          },
        }));
      for (const { entry } of batch) activity.push({ ...entry });
      save({});
      const longest = Math.max(...batch.map(({ operation }) => operation.ms));
      // Parallel operations finish one after another across the batch.
      for (const [position, { operation, entry }] of batch.entries()) {
        await sleep(position === 0 ? longest - (batch.length - 1) * 150 : 150);
        const saved = activity.find((item) => item.id === entry.id);
        if (saved) {
          saved.label = operation.done;
          saved.status = operation.fails ? 'failed' : 'completed';
        }
        save({});
      }
      next = end;
    }
    save({ status: 'succeeded', result: { ok: true } });
    update(index, {
      status: 'completed',
      detail: {
        kind: 'macro',
        input,
        output: {
          executionId: execution,
          status: 'succeeded',
          activity: structuredClone(activity),
        },
        error: null,
      },
    });
    model.rows.set(
      id,
      activity.map((item) => ({
        id: `${id}:${item.id}`,
        label: item.label,
        detail: null,
        status: item.status === 'failed' ? 'failed' : 'completed',
        card: null,
      }))
    );
    commit();
  }
}

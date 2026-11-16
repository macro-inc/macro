import { INBOX, never } from './draft-sync-shared';

/** A refusal the simulated server answers with, as `extensions.code`. */
export class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

type DraftInput = {
  draftId: string | number;
  draftGeneration?: number | null;
  threadDbId?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  replyingToId?: string | number | null;
};
type SendInput = { attempt: { attemptId: string }; message: DraftInput };
type AttemptInput = { attemptId: string };

/** The draft or attempt a request is about, whichever operation it is. */
function subjectOf(input: unknown): string | undefined {
  const fields = (input ?? {}) as Partial<
    DraftInput & SendInput & AttemptInput
  >;
  const id = fields.draftId ?? fields.message?.draftId ?? fields.attemptId;
  return id == null ? undefined : String(id);
}

export type Fault =
  /** The request never reaches the server. */
  | { kind: 'network' }
  /** The server applies the request and the response is lost. */
  | { kind: 'lost' }
  | { kind: 'http'; status: number }
  /** A GraphQL error; `applied` commits the write first. */
  | { kind: 'graphql'; code: string; applied?: boolean }
  /** The server holds the request this long before working on it. */
  | { kind: 'slow'; ms: number };

export type ServerRequest = {
  operation: string;
  draftId?: string;
  /** Requests this server has seen for the operation and draft, this one included. */
  nth: number;
};

type ServerRow = {
  id: string;
  threadId: string;
  generation: number;
  subject: string;
  body: string;
  replyingToId?: string;
  state: 'draft' | 'delivering' | 'sent';
};

type ServerAttempt = {
  attemptId: string;
  rowId: string;
  status: 'ACCEPTED' | 'SENT' | 'CANCELLED';
  deliverAt: number;
};

/** A fault that stops the request before the server works on it. */
function failBefore(fault: Fault | undefined) {
  if (fault?.kind === 'network') throw new TypeError('Failed to fetch');
  if (fault?.kind === 'graphql' && !fault.applied)
    throw new Refusal(fault.code, 'email draft mutation failed');
}

/** A fault that loses or replaces the answer after the server did the work. */
function failAfter(fault: Fault | undefined) {
  if (fault?.kind === 'lost') throw new TypeError('Failed to fetch');
  if (fault?.kind === 'graphql')
    throw new Refusal(fault.code, 'email draft mutation failed');
}

/** The server's drafts, send attempts and deliveries, with programmable faults. */
export function createServer() {
  const rows = new Map<string, ServerRow>();
  const ids = new Map<string, string>();
  const attempts = new Map<string, ServerAttempt>();
  const delivered: { attemptId: string; draftId: string; body: string }[] = [];
  const requests: (ServerRequest & { at: number })[] = [];
  const counts = new Map<string, number>();
  const state = {
    latencyMs: 20,
    deliveryMs: 3_000,
    fault: undefined as
      | ((request: ServerRequest) => Fault | undefined)
      | undefined,
  };

  const find = (id: unknown) => {
    const row = rows.get(ids.get(String(id)) ?? '');
    return row;
  };
  const create = (handle: string, threadId: string): ServerRow => {
    const row: ServerRow = {
      // Server ids are UUIDs: a confirmed draft's id becomes a queue key.
      id: crypto.randomUUID(),
      threadId,
      generation: 0,
      subject: '',
      body: '',
      state: 'draft',
    };
    rows.set(row.id, row);
    ids.set(handle, row.id);
    ids.set(row.id, row.id);
    return row;
  };
  const refuseReplyToDraft = (replyingToId: unknown) => {
    if (replyingToId == null) return;
    const target = find(replyingToId);
    if (target && target.state !== 'sent')
      throw new Refusal('INVALID', 'cannot reply to a draft');
  };
  /** Provider delivery completes on the server's own clock. */
  const deliver = () => {
    for (const attempt of attempts.values()) {
      if (attempt.status !== 'ACCEPTED' || attempt.deliverAt > Date.now())
        continue;
      const row = rows.get(attempt.rowId);
      if (!row) continue;
      attempt.status = 'SENT';
      row.state = 'sent';
      delivered.push({
        attemptId: attempt.attemptId,
        draftId: row.id,
        body: row.body,
      });
    }
  };
  const message = (row: ServerRow) => ({
    __typename: 'GraphqlSoupEmailMessage',
    id: row.id,
    threadId: row.threadId,
    draftGeneration: row.generation,
    replyingToId: row.replyingToId ?? null,
    linkId: INBOX,
    subject: row.subject,
    bodyText: row.body,
    isDraft: row.state !== 'sent',
    isSent: row.state === 'sent',
  });
  const attemptView = (attempt: ServerAttempt) => {
    const row = rows.get(attempt.rowId);
    return {
      attemptId: attempt.attemptId,
      status: attempt.status,
      sendTime: null,
      threadId: row?.threadId ?? null,
      message: row ? message(row) : null,
    };
  };

  const operations = {
    // Lists the cache cannot keep current are read again after a write.
    EmailThreadPage: () => ({ user: null }),
    SaveEmailDraft(input: DraftInput) {
      refuseReplyToDraft(input.replyingToId);
      let row = find(input.draftId);
      if (row) {
        if (row.state === 'sent')
          throw new Refusal(
            'DRAFT_ALREADY_SENT',
            'email draft has already been sent'
          );
        if (row.state === 'delivering')
          throw new Refusal(
            'INVALID',
            'cancel scheduled delivery before editing this draft'
          );
        if (row.generation !== (input.draftGeneration ?? 0))
          throw new Refusal(
            'DRAFT_VERSION_CONFLICT',
            'draft changed on another device'
          );
      } else {
        row = create(String(input.draftId), String(input.threadDbId));
      }
      row.subject = input.subject ?? '';
      row.body = input.bodyText ?? '';
      row.replyingToId =
        input.replyingToId == null ? undefined : String(input.replyingToId);
      return {
        saveEmailDraft: {
          draftId: row.id,
          draft: message(row),
          thread: { __typename: 'GraphqlSoupEmailThread', id: row.threadId },
        },
      };
    },
    DeleteEmailDraft(input: DraftInput) {
      const row = find(input.draftId);
      const gone = {
        draftId: String(input.draftId),
        deleted: false,
        threadDeleted: false,
        threadId: null,
        thread: null,
      };
      if (!row) return { deleteEmailDraft: gone };
      if (row.state === 'sent')
        throw new Refusal(
          'DRAFT_ALREADY_SENT',
          'email draft has already been sent'
        );
      if (row.state === 'delivering')
        throw new Refusal(
          'INVALID',
          'cancel scheduled delivery before editing this draft'
        );
      if (row.generation !== (input.draftGeneration ?? 0))
        throw new Refusal(
          'DRAFT_VERSION_CONFLICT',
          'draft changed on another device'
        );
      rows.delete(row.id);
      for (const [handle, id] of [...ids])
        if (id === row.id) ids.delete(handle);
      return {
        deleteEmailDraft: { ...gone, deleted: true, threadId: row.threadId },
      };
    },
    SendEmailMessage(input: SendInput) {
      const known = attempts.get(input.attempt.attemptId);
      if (known) return attemptView(known);
      const sent = input.message;
      refuseReplyToDraft(sent.replyingToId);
      let row = find(sent.draftId);
      if (row) {
        if (row.state === 'sent')
          throw new Refusal(
            'DRAFT_ALREADY_SENT',
            'email draft has already been sent'
          );
        if (row.state === 'delivering')
          throw new Refusal(
            'SEND_ATTEMPT_CONFLICT',
            'send attempt was reused with different content'
          );
        if (row.generation !== (sent.draftGeneration ?? 0))
          throw new Refusal(
            'DRAFT_VERSION_CONFLICT',
            'draft changed on another device'
          );
      } else {
        row = create(String(sent.draftId), String(sent.threadDbId));
      }
      row.subject = sent.subject ?? '';
      row.body = sent.bodyText ?? '';
      row.replyingToId =
        sent.replyingToId == null ? undefined : String(sent.replyingToId);
      row.generation += 1;
      row.state = 'delivering';
      const attempt: ServerAttempt = {
        attemptId: input.attempt.attemptId,
        rowId: row.id,
        status: 'ACCEPTED',
        deliverAt: Date.now() + state.deliveryMs,
      };
      attempts.set(attempt.attemptId, attempt);
      return attemptView(attempt);
    },
    CancelEmailSend(input: AttemptInput) {
      let attempt = attempts.get(input.attemptId);
      if (!attempt) {
        // Cancelled before it arrived: the tombstone refuses a late send.
        attempt = {
          attemptId: input.attemptId,
          rowId: '',
          status: 'CANCELLED',
          deliverAt: 0,
        };
        attempts.set(attempt.attemptId, attempt);
      }
      const row = rows.get(attempt.rowId);
      if (attempt.status === 'ACCEPTED' && row) {
        attempt.status = 'CANCELLED';
        row.state = 'draft';
        row.generation += 1;
      }
      return attemptView(attempt);
    },
    EmailSendAttempt(input: AttemptInput) {
      const attempt = attempts.get(input.attemptId);
      return attempt ? attemptView(attempt) : null;
    },
  };

  /**
   * One request: latency, the planned fault, then the operation. Resolves with
   * the operation's data or rejects with a `Refusal` or a transport failure.
   */
  async function handle(
    operation: string,
    input: unknown,
    page: { alive: boolean },
    signal?: AbortSignal | null
  ): Promise<{ data: unknown } | { status: number }> {
    const draftId = subjectOf(input);
    const key = `${operation}:${draftId}`;
    const nth = (counts.get(key) ?? 0) + 1;
    counts.set(key, nth);
    const request = { operation, draftId, nth };
    requests.push({ ...request, at: Date.now() });
    const fault = state.fault?.(request);
    await wait(
      state.latencyMs + (fault?.kind === 'slow' ? fault.ms : 0),
      signal
    );
    failBefore(fault);
    if (fault?.kind === 'http') return { status: fault.status };
    deliver();
    if (!(operation in operations))
      throw new Error(`The simulated server has no ${operation}`);
    const run = operations[operation as keyof typeof operations] as (
      input: unknown
    ) => unknown;
    const data = run(input);
    failAfter(fault);
    // A page that reloaded never hears the answer to what it sent.
    if (!page.alive) return await never();
    return { data };
  }

  return {
    state,
    handle,
    deliver,
    requests,
    delivered,
    /** The draft a handle or server id names, if the server still holds one. */
    draft: (id: string) => {
      deliver();
      const row = find(id);
      return row?.state === 'sent' ? undefined : row;
    },
    row: (id: string) => {
      deliver();
      return find(id);
    },
    drafts: () => {
      deliver();
      return [...rows.values()].filter((row) => row.state !== 'sent');
    },
  };
}

/** A pause on the fake clock that an aborted request cuts short. */
export function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

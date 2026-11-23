/**
 * The agent harness's `/agent-feedback` routes. Each call is one client span
 * whose trace context travels to the harness, so a rating's trace runs from
 * the click through the write.
 *
 * The wire types and paths are declared here until the backend's routes are
 * in the generated harness client (`@service-agent-harness/generated`); then
 * this adapter should build its requests from it. The operations, by id:
 * `agent_feedback_{rate,retract}_turn`, `agent_feedback_my_turn_feedback`,
 * `agent_feedback_{rate,retract}_message`,
 * `agent_feedback_my_message_feedback`, `agent_feedback_{rate,retract}_run`,
 * `agent_feedback_my_run_feedback`, `agent_feedback_{rate,retract}_suggestion`
 * and `agent_feedback_my_suggestion_feedback`.
 */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ResultError } from '@core/util/result';
import type { BaseFetchErrorCode } from '@core/util/safeFetch';
import { Telemetry } from '@macro-inc/observability';
import { AsyncBatcher } from '@tanstack/pacer';
import { err, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  FeedbackContainer,
  FeedbackRating,
  FeedbackState,
  FeedbackSubject,
  FeedbackSurface,
  MyFeedbackItem,
} from '../core/subject';

type FetchErrors = ResultError<BaseFetchErrorCode>[];

type FeedbackFetchResult<T> = Promise<Result<T, FetchErrors>>;

/** The current state after a write; no rating once retracted. */
type FeedbackStateDto = {
  rating: FeedbackRating | null;
  note: string | null;
  updatedAt: string | null;
};

/** One rated response: the session's turn, or the message, run or suggestion. */
type MyFeedbackDto = {
  subjectId: string;
  turn: number | null;
  rating: FeedbackRating;
  note: string | null;
  updatedAt: string;
};

type MyFeedbackResponseDto = { items: MyFeedbackDto[] };

type RateFeedbackBodyDto = {
  id: string;
  rating: FeedbackRating;
  note: string | null;
  surface: FeedbackSurface;
};

export type RateRequest = {
  id: string;
  rating: FeedbackRating;
  note: string | null;
  surface: FeedbackSurface;
};

export type RetractRequest = { id: string; surface: FeedbackSurface };

export type AgentFeedbackClient = {
  mine(container: FeedbackContainer): FeedbackFetchResult<MyFeedbackItem[]>;
  rate(
    subject: FeedbackSubject,
    request: RateRequest
  ): FeedbackFetchResult<FeedbackState | undefined>;
  retract(
    subject: FeedbackSubject,
    request: RetractRequest
  ): FeedbackFetchResult<void>;
};

/** The most suggestion ids one `mine` request may name. */
export const SUGGESTION_MINE_MAX_IDS = 100;

/** How long suggestion reads wait to share a request with their neighbours. */
const SUGGESTION_BATCH_WINDOW_MS = 10;

/** A subject this build can't address: the request fails rather than guess. */
const UNKNOWN_SUBJECT: FetchErrors = [
  { code: 'UNKNOWN_ERROR', message: 'Unknown feedback subject' },
];

const host = () => `${SERVER_HOSTS['agent-harness']}/agent-feedback`;
const segment = encodeURIComponent;

function mineUrl(
  container: Exclude<FeedbackContainer, { kind: 'suggestion' }>
): string | undefined {
  return match(container)
    .with(
      { kind: 'agent_session' },
      (c) => `/agent-sessions/${segment(c.sessionId)}/mine`
    )
    .with(
      { kind: 'message_parent' },
      (c) => `/messages/${segment(c.parentType)}/${segment(c.parentId)}/mine`
    )
    .with({ kind: 'routine' }, (c) => `/routines/${segment(c.routineId)}/mine`)
    .exhaustive(() => undefined);
}

function suggestionsMineUrl(ids: string[]): string {
  return `/suggestions/mine?ids=${ids.map(segment).join(',')}`;
}

function subjectUrl(subject: FeedbackSubject): string | undefined {
  return match(subject)
    .with(
      { kind: 'agent_session_turn' },
      (s) => `/agent-sessions/${segment(s.sessionId)}/turns/${s.turn}`
    )
    .with(
      { kind: 'message' },
      (s) =>
        `/messages/${segment(s.parentType)}/${segment(s.parentId)}/items/${segment(s.messageId)}`
    )
    .with(
      { kind: 'routine_run' },
      (s) => `/routines/${segment(s.routineId)}/runs/${segment(s.runId)}`
    )
    .with(
      { kind: 'suggestion' },
      (s) => `/suggestions/${segment(s.suggestionId)}`
    )
    .exhaustive(() => undefined);
}

function retractUrl(
  subject: FeedbackSubject,
  params: RetractRequest
): string | undefined {
  const path = subjectUrl(subject);
  if (!path) return undefined;
  const query = new URLSearchParams({ id: params.id, surface: params.surface });
  return `${path}?${query}`;
}

/** The ids a span about this subject records, by attribute name. */
function subjectAttributes(
  subject: FeedbackSubject
): Record<string, string | number> {
  return match(subject)
    .with({ kind: 'agent_session_turn' }, (s) => ({
      'agent.session.id': s.sessionId,
      'agent.turn': s.turn,
    }))
    .with({ kind: 'message' }, (s) => ({
      'message.parent_type': s.parentType,
      'message.parent_id': s.parentId,
      'message.id': s.messageId,
    }))
    .with({ kind: 'routine_run' }, (s) => ({
      'routine.id': s.routineId,
      'routine.run_id': s.runId,
    }))
    .with({ kind: 'suggestion' }, (s) => ({
      'suggestion.id': s.suggestionId,
    }))
    .exhaustive(() => ({}));
}

function toState(dto: FeedbackStateDto): FeedbackState | undefined {
  if (!dto.rating || !dto.updatedAt) return undefined;
  return {
    rating: dto.rating,
    note: dto.note ?? null,
    updatedAt: dto.updatedAt,
  };
}

/** One rated response, keyed the way `responseKey` keys its subject. */
function toItem(
  container: FeedbackContainer,
  item: MyFeedbackDto
): MyFeedbackItem[] {
  const fields = {
    rating: item.rating,
    note: item.note ?? null,
    updatedAt: item.updatedAt,
  };
  if (container.kind !== 'agent_session')
    return [{ key: item.subjectId, ...fields }];
  // A session's ratings are per turn; one without a turn isn't a reply's.
  if (item.turn == null) return [];
  return [{ key: String(item.turn), ...fields }];
}

/** Opens the operation's client span and the headers that carry it. */
function startSpan(name: string, subjectKind: string) {
  const span = Telemetry.span(name, { kind: 'client' });
  span.setAttr('agent_feedback.subject_kind', subjectKind);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  span.injectTraceHeaders(headers);
  return { span, headers };
}

function startSubjectSpan(name: string, subject: FeedbackSubject) {
  const started = startSpan(name, subject.kind);
  for (const [attribute, value] of Object.entries(subjectAttributes(subject)))
    started.span.setAttr(attribute, value);
  return started;
}

/** The server's answer that this person can't rate here: feature off, or no access. */
export function isRefusal(errors: ResultError<string>[]): boolean {
  return errors.some(
    (error) => error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'
  );
}

/** One `mine` request under its own span. */
async function readMine(
  url: string,
  subjectKind: string,
  attributes: Record<string, string | number>
): FeedbackFetchResult<MyFeedbackDto[]> {
  const { span, headers } = startSpan('agent_feedback.mine', subjectKind);
  for (const [attribute, value] of Object.entries(attributes))
    span.setAttr(attribute, value);
  try {
    const result = await fetchWithToken<MyFeedbackResponseDto>(
      `${host()}${url}`,
      { method: 'GET', headers, trace: { parentSpan: span } }
    );
    // A 404 (feature off) or 403 is an answer, not a failure.
    if (result.isErr() && !isRefusal(result.error))
      span.error('Reading agent feedback failed');
    return result.map(({ items }) => {
      span.setAttr('agent_feedback.count', items.length);
      return items;
    });
  } finally {
    span.end();
  }
}

type MineAnswer = Result<MyFeedbackDto[], FetchErrors>;

type SuggestionRead = { id: string; resolve: (answer: MineAnswer) => void };

/**
 * Suggestion reads made together (the rows of one list mounting) share one
 * request of at most `SUGGESTION_MINE_MAX_IDS` ids; each read gets its own
 * items.
 */
function createSuggestionMineBatcher(
  read: (ids: string[]) => Promise<MineAnswer>
) {
  const batcher = new AsyncBatcher<SuggestionRead>(
    async (reads) => {
      const answer = await read([...new Set(reads.map((r) => r.id))]);
      for (const { id, resolve } of reads)
        resolve(
          answer.map((items) => items.filter((item) => item.subjectId === id))
        );
    },
    {
      wait: SUGGESTION_BATCH_WINDOW_MS,
      maxSize: SUGGESTION_MINE_MAX_IDS,
      onError: (error, reads) => {
        for (const { resolve } of reads)
          resolve(err([{ code: 'UNKNOWN_ERROR', message: String(error) }]));
      },
      throwOnError: false,
    }
  );
  return (id: string) =>
    new Promise<MineAnswer>((resolve) => {
      fireAndForget(batcher.addItem({ id, resolve }), 'agent-feedback');
    });
}

const readSuggestionMine = createSuggestionMineBatcher((ids) =>
  readMine(suggestionsMineUrl(ids), 'suggestion', {
    'agent_feedback.requested': ids.length,
  })
);

function readContainer(container: FeedbackContainer): Promise<MineAnswer> {
  if (container.kind === 'suggestion')
    return readSuggestionMine(container.suggestionId);
  const url = mineUrl(container);
  if (!url) return Promise.resolve(err(UNKNOWN_SUBJECT));
  return readMine(url, container.kind, {});
}

export const agentFeedbackClient: AgentFeedbackClient = {
  async mine(container) {
    const items = await readContainer(container);
    return items.map((list) => list.flatMap((item) => toItem(container, item)));
  },

  async rate(subject, request) {
    const url = subjectUrl(subject);
    if (!url) return err(UNKNOWN_SUBJECT);
    const { span, headers } = startSubjectSpan('agent_feedback.rate', subject);
    span.setAttr('agent_feedback.id', request.id);
    span.setAttr('agent_feedback.rating', request.rating);
    span.setAttr('agent_feedback.surface', request.surface);
    span.setAttr('agent_feedback.has_note', request.note !== null);
    const body: RateFeedbackBodyDto = {
      id: request.id,
      rating: request.rating,
      note: request.note,
      surface: request.surface,
    };
    try {
      const result = await fetchWithToken<FeedbackStateDto>(`${host()}${url}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
        // The id makes a repeated PUT a no-op, so a lost answer is retried.
        retry: { maxTries: 2 },
        trace: { parentSpan: span },
      });
      if (result.isErr()) span.error('Rating an agent response failed');
      return result.map(toState);
    } finally {
      span.end();
    }
  },

  async retract(subject, request) {
    const url = retractUrl(subject, request);
    if (!url) return err(UNKNOWN_SUBJECT);
    const { span, headers } = startSubjectSpan(
      'agent_feedback.retract',
      subject
    );
    span.setAttr('agent_feedback.id', request.id);
    span.setAttr('agent_feedback.surface', request.surface);
    try {
      const result = await fetchWithToken<Record<string, never>>(
        `${host()}${url}`,
        {
          method: 'DELETE',
          headers,
          retry: { maxTries: 2 },
          trace: { parentSpan: span },
        }
      );
      if (result.isErr()) span.error('Retracting a rating failed');
      return result.map(() => undefined);
    } finally {
      span.end();
    }
  },
};

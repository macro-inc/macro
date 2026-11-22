/**
 * The agent harness's `/agent-feedback` routes, through the generated
 * client's URLs and types. Each call is one client span whose trace context
 * travels to the harness, so a rating's trace runs from the click through the
 * write.
 */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import type { BaseFetchErrorCode } from '@core/util/safeFetch';
import { Telemetry } from '@macro-inc/observability';
import {
  getAgentFeedbackMyMessageFeedbackUrl,
  getAgentFeedbackMyRunFeedbackUrl,
  getAgentFeedbackMyTurnFeedbackUrl,
  getAgentFeedbackRateMessageUrl,
  getAgentFeedbackRateRunUrl,
  getAgentFeedbackRateTurnUrl,
  getAgentFeedbackRetractMessageUrl,
  getAgentFeedbackRetractRunUrl,
  getAgentFeedbackRetractTurnUrl,
} from '@service-agent-harness/generated/client';
import type {
  FeedbackState as FeedbackStateDto,
  MyFeedback,
  MyFeedbackResponse,
  RateFeedbackBody,
} from '@service-agent-harness/generated/schemas';
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

type FeedbackFetchResult<T> = Promise<
  Result<T, ResultError<BaseFetchErrorCode>[]>
>;

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

const host = () => SERVER_HOSTS['agent-harness'];
const segment = encodeURIComponent;

/** A subject this build can't address: the request fails rather than guess. */
const UNKNOWN_SUBJECT: ResultError<BaseFetchErrorCode>[] = [
  { code: 'UNKNOWN_ERROR', message: 'Unknown feedback subject' },
];

function mineUrl(container: FeedbackContainer): string | undefined {
  return match(container)
    .with({ kind: 'agent_session' }, (c) =>
      getAgentFeedbackMyTurnFeedbackUrl(segment(c.sessionId))
    )
    .with({ kind: 'message_parent' }, (c) =>
      getAgentFeedbackMyMessageFeedbackUrl(
        segment(c.parentType),
        segment(c.parentId)
      )
    )
    .with({ kind: 'routine' }, (c) =>
      getAgentFeedbackMyRunFeedbackUrl(segment(c.routineId))
    )
    .exhaustive(() => undefined);
}

function rateUrl(subject: FeedbackSubject): string | undefined {
  return match(subject)
    .with({ kind: 'agent_session_turn' }, (s) =>
      getAgentFeedbackRateTurnUrl(segment(s.sessionId), s.turn)
    )
    .with({ kind: 'message' }, (s) =>
      getAgentFeedbackRateMessageUrl(
        segment(s.parentType),
        segment(s.parentId),
        segment(s.messageId)
      )
    )
    .with({ kind: 'routine_run' }, (s) =>
      getAgentFeedbackRateRunUrl(segment(s.routineId), segment(s.runId))
    )
    .exhaustive(() => undefined);
}

function retractUrl(
  subject: FeedbackSubject,
  params: RetractRequest
): string | undefined {
  return match(subject)
    .with({ kind: 'agent_session_turn' }, (s) =>
      getAgentFeedbackRetractTurnUrl(segment(s.sessionId), s.turn, params)
    )
    .with({ kind: 'message' }, (s) =>
      getAgentFeedbackRetractMessageUrl(
        segment(s.parentType),
        segment(s.parentId),
        segment(s.messageId),
        params
      )
    )
    .with({ kind: 'routine_run' }, (s) =>
      getAgentFeedbackRetractRunUrl(
        segment(s.routineId),
        segment(s.runId),
        params
      )
    )
    .exhaustive(() => undefined);
}

/** The ids a span about this subject records, by attribute name. */
function subjectAttributes(
  subject: FeedbackSubject
): Record<string, string | number> {
  return match(subject)
    .with({ kind: 'agent_session_turn' }, (s) => ({
      'agent.session.id': s.sessionId,
      'agent_feedback.turn': s.turn,
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
    .exhaustive(() => ({}));
}

function toState(dto: FeedbackStateDto): FeedbackState | undefined {
  if (!dto.rating || !dto.updatedAt) return undefined;
  return { rating: dto.rating, note: dto.note, updatedAt: dto.updatedAt };
}

/** One rated response, keyed the way `responseKey` keys its subject. */
function toItem(
  container: FeedbackContainer,
  item: MyFeedback
): MyFeedbackItem[] {
  const fields = {
    rating: item.rating,
    note: item.note,
    updatedAt: item.updatedAt,
  };
  if (container.kind !== 'agent_session')
    return [{ key: item.subjectId, ...fields }];
  // A session's ratings are per turn; one without a turn isn't a reply's.
  if (item.turn === null) return [];
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

export const agentFeedbackClient: AgentFeedbackClient = {
  async mine(container) {
    const url = mineUrl(container);
    if (!url) return err(UNKNOWN_SUBJECT);
    const { span, headers } = startSpan('agent_feedback.mine', container.kind);
    try {
      const result = await fetchWithToken<MyFeedbackResponse>(
        `${host()}${url}`,
        { method: 'GET', headers, trace: { parentSpan: span } }
      );
      // A 404 (feature off) or 403 is an answer, not a failure.
      if (result.isErr() && !isRefusal(result.error))
        span.error('Reading agent feedback failed');
      return result.map(({ items }) => {
        const rated = items.flatMap((item) => toItem(container, item));
        span.setAttr('agent_feedback.count', rated.length);
        return rated;
      });
    } finally {
      span.end();
    }
  },

  async rate(subject, request) {
    const url = rateUrl(subject);
    if (!url) return err(UNKNOWN_SUBJECT);
    const { span, headers } = startSubjectSpan('agent_feedback.rate', subject);
    span.setAttr('agent_feedback.id', request.id);
    span.setAttr('agent_feedback.rating', request.rating);
    span.setAttr('agent_feedback.surface', request.surface);
    span.setAttr('agent_feedback.has_note', request.note !== null);
    const body: RateFeedbackBody = {
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

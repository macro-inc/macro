/**
 * The agent harness's `/agent-feedback` routes. Each call is one client span
 * whose trace context travels to the harness, so a rating's trace runs from
 * the click through the write.
 */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import type { BaseFetchErrorCode } from '@core/util/safeFetch';
import { Telemetry } from '@macro-inc/observability';
import type { Result } from 'neverthrow';
import { containerPath, subjectAttributes, subjectPath } from '../core/routes';
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

/** The current state after a write; no rating once retracted. */
type FeedbackStateDto = {
  rating?: FeedbackRating | null;
  note?: string | null;
  updatedAt?: string | null;
};

/** One rated response: the session's turn, or the message or run itself. */
type MyFeedbackDto = {
  subjectId: string;
  turn?: number | null;
  rating: FeedbackRating;
  note?: string | null;
  updatedAt: string;
};

type MyFeedbackResponseDto = { items: MyFeedbackDto[] };

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

const host = () => `${SERVER_HOSTS['agent-harness']}/agent-feedback`;

function toState(dto: FeedbackStateDto): FeedbackState | undefined {
  if (!dto.rating || !dto.updatedAt) return undefined;
  return {
    rating: dto.rating,
    note: dto.note ?? null,
    updatedAt: dto.updatedAt,
  };
}

/** The item's response key in its container, as `responseKey` makes it. */
function itemKey(
  container: FeedbackContainer,
  item: MyFeedbackDto
): string | undefined {
  if (container.kind !== 'agent_session') return item.subjectId;
  return item.turn == null ? undefined : String(item.turn);
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

export const agentFeedbackClient: AgentFeedbackClient = {
  async mine(container) {
    const { span, headers } = startSpan('agent_feedback.mine', container.kind);
    try {
      const result = await fetchWithToken<MyFeedbackResponseDto>(
        `${host()}${containerPath(container)}/mine`,
        { method: 'GET', headers, trace: { parentSpan: span } }
      );
      if (result.isErr()) span.error('Reading agent feedback failed');
      return result.map(({ items }) => {
        const rated = items.flatMap((item): MyFeedbackItem[] => {
          const key = itemKey(container, item);
          if (key === undefined) return [];
          return [
            {
              key,
              rating: item.rating,
              note: item.note ?? null,
              updatedAt: item.updatedAt,
            },
          ];
        });
        span.setAttr('agent_feedback.count', rated.length);
        return rated;
      });
    } finally {
      span.end();
    }
  },

  async rate(subject, request) {
    const { span, headers } = startSpan('agent_feedback.rate', subject.kind);
    for (const [name, value] of Object.entries(subjectAttributes(subject)))
      span.setAttr(name, value);
    span.setAttr('agent_feedback.id', request.id);
    span.setAttr('agent_feedback.rating', request.rating);
    span.setAttr('agent_feedback.surface', request.surface);
    span.setAttr('agent_feedback.has_note', request.note !== null);
    try {
      const result = await fetchWithToken<FeedbackStateDto>(
        `${host()}${subjectPath(subject)}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            id: request.id,
            rating: request.rating,
            note: request.note ?? undefined,
            surface: request.surface,
          }),
          // The id makes a repeated PUT a no-op, so a lost answer is retried.
          retry: { maxTries: 2 },
          trace: { parentSpan: span },
        }
      );
      if (result.isErr()) span.error('Rating an agent response failed');
      return result.map(toState);
    } finally {
      span.end();
    }
  },

  async retract(subject, request) {
    const { span, headers } = startSpan('agent_feedback.retract', subject.kind);
    for (const [name, value] of Object.entries(subjectAttributes(subject)))
      span.setAttr(name, value);
    span.setAttr('agent_feedback.id', request.id);
    span.setAttr('agent_feedback.surface', request.surface);
    try {
      const query = new URLSearchParams({
        id: request.id,
        surface: request.surface,
      });
      const result = await fetchWithToken<Record<string, never>>(
        `${host()}${subjectPath(subject)}?${query}`,
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

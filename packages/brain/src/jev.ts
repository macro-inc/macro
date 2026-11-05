// Jev: should this message wake the agent? The agent owns config/jev.json
// (Tod's format: threshold, yes/no questions, a prose `rule`, and the
// machine-checked `wakeIf`). A message is relevant when any `wakeIf` group
// has all its questions at or above the threshold. @mentions and DMs skip
// the model. Every decision is a line in log/decisions.jsonl.
import type { DecideRequest, DecideResponse } from './macro.ts';
import { withSpan } from './telemetry.ts';

/** Limits the decide endpoint enforces (crates/agent_brain relevance.rs). */
export const MAX_QUESTIONS = 32;
export const MAX_KEY_BYTES = 80;
export const MAX_BODY_BYTES = 64 * 1024;
export const DEFAULT_MAX_QUESTION_CHARS = 500;

export type JevConfig = {
  threshold: number;
  questions: Record<string, string>;
  /** The wake rule in words, for the agent reading its own file. */
  rule: string;
  wakeIf: string[][];
  maxQuestionChars: number;
};

export class JevConfigError extends Error {}

export function parseJevConfig(raw: unknown): JevConfig {
  const fail = (message: string): never => {
    throw new JevConfigError(`config/jev.json: ${message}`);
  };
  if (typeof raw !== 'object' || raw === null) return fail('must be an object');

  const value = raw as Record<string, unknown>;
  const threshold = value.threshold;
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    return fail('threshold must be a number within 0..1');
  }

  const maxQuestionChars =
    value.max_question_chars ?? DEFAULT_MAX_QUESTION_CHARS;
  if (
    typeof maxQuestionChars !== 'number' ||
    maxQuestionChars < 1 ||
    maxQuestionChars > DEFAULT_MAX_QUESTION_CHARS
  ) {
    return fail(`max_question_chars must be 1..${DEFAULT_MAX_QUESTION_CHARS}`);
  }

  const questions = parseQuestions(value.questions, maxQuestionChars);

  const rule = value.rule;
  if (typeof rule !== 'string')
    return fail('rule must describe the wake rule in words');

  return {
    threshold,
    questions,
    rule,
    wakeIf: parseWakeIf(value.wakeIf, questions),
    maxQuestionChars,
  };
}

function parseQuestions(
  raw: unknown,
  maxQuestionChars: number
): Record<string, string> {
  if (typeof raw !== 'object' || raw === null)
    throw new JevConfigError('config/jev.json: questions must be an object');
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_QUESTIONS) {
    throw new JevConfigError(
      `config/jev.json: needs 1 to ${MAX_QUESTIONS} questions, has ${entries.length}`
    );
  }
  const questions: Record<string, string> = {};
  for (const [key, question] of entries) {
    const keyBytes = new TextEncoder().encode(key).length;
    if (keyBytes === 0 || keyBytes > MAX_KEY_BYTES) {
      throw new JevConfigError(
        `config/jev.json: question key ${JSON.stringify(key)} must be 1 to ${MAX_KEY_BYTES} bytes`
      );
    }
    const length = typeof question === 'string' ? [...question].length : 0;
    if (
      typeof question !== 'string' ||
      question.trim() === '' ||
      length > maxQuestionChars
    ) {
      throw new JevConfigError(
        `config/jev.json: question ${JSON.stringify(key)} must be 1 to ${maxQuestionChars} characters`
      );
    }
    questions[key] = question;
  }
  return questions;
}

function parseWakeIf(
  raw: unknown,
  questions: Record<string, string>
): string[][] {
  if (!Array.isArray(raw) || raw.length === 0)
    throw new JevConfigError(
      'config/jev.json: wakeIf needs at least one group'
    );
  return raw.map((group: unknown) => {
    if (!Array.isArray(group) || group.length === 0)
      throw new JevConfigError('config/jev.json: wakeIf has an empty group');
    return group.map((key: unknown) => {
      if (typeof key !== 'string' || !(key in questions)) {
        throw new JevConfigError(
          `config/jev.json: wakeIf names unknown question ${JSON.stringify(key)}`
        );
      }
      return key;
    });
  });
}

/** Whether `probabilities` satisfy the wake rule; missing keys count as 0. */
export function isRelevant(
  config: JevConfig,
  probabilities: Record<string, number>
): boolean {
  return config.wakeIf.some((group) =>
    group.every((key) => (probabilities[key] ?? 0) >= config.threshold)
  );
}

export type JudgedMessage = {
  id: string;
  from: string;
  at: string;
  text: string;
  thread: string | null;
};

export type Candidate = {
  messageId: string;
  channel: string;
  mentionsMe: boolean;
  directMessage: boolean;
  /** Whether the agent has posted in this message's thread. */
  inMyThread: boolean;
  message: JudgedMessage;
  recent: JudgedMessage[];
};

export type Reason =
  | 'mentioned'
  | 'direct_message'
  | 'decided'
  | 'in_my_thread';

export type Decision = {
  relevant: boolean;
  reason: Reason;
  probabilities: Record<string, number>;
};

export type DecisionInput = {
  channel: string;
  direct_message: boolean;
  recent_messages: JudgedMessage[];
  new_message: JudgedMessage;
};

/** Drop the oldest recent messages until the request fits the endpoint's body limit. */
export function fitBody(request: {
  input: DecisionInput;
  questions: Record<string, string>;
}): DecideRequest {
  const fitted = {
    ...request,
    input: {
      ...request.input,
      recent_messages: [...request.input.recent_messages],
    },
  };
  while (
    new TextEncoder().encode(JSON.stringify(fitted)).length > MAX_BODY_BYTES
  ) {
    if (fitted.input.recent_messages.length === 0) {
      throw new JevConfigError(
        `the decision request is over the ${MAX_BODY_BYTES} byte limit`
      );
    }
    fitted.input.recent_messages.shift();
  }
  return fitted;
}

export type JevDeps = {
  config(): Promise<JevConfig>;
  decide(request: DecideRequest): Promise<DecideResponse>;
  log(line: object): Promise<void>;
  now?: () => Date;
};

/** Judge one message. A failed decide call retries with less context, then falls back to "my thread". */
export async function judge(
  candidate: Candidate,
  deps: JevDeps
): Promise<Decision> {
  return withSpan('brain.jev.decide', {}, async (span) => {
    const decision = await decideCandidate(candidate, deps);
    span.setAttribute('jev.relevant', decision.relevant);
    span.setAttribute('jev.reason', decision.reason);
    const scores = Object.values(decision.probabilities);
    if (scores.length) span.setAttribute('jev.score', Math.max(...scores));
    await deps.log({
      at: (deps.now ?? (() => new Date()))().toISOString(),
      message_id: candidate.messageId,
      relevant: decision.relevant,
      reason: decision.reason,
      p: decision.probabilities,
    });
    return decision;
  });
}

async function decideCandidate(
  candidate: Candidate,
  deps: JevDeps
): Promise<Decision> {
  if (candidate.mentionsMe)
    return { relevant: true, reason: 'mentioned', probabilities: {} };
  if (candidate.directMessage)
    return { relevant: true, reason: 'direct_message', probabilities: {} };

  const config = await deps.config();
  const ask = async (recent: JudgedMessage[]): Promise<Decision> => {
    const request = fitBody({
      input: {
        channel: candidate.channel,
        direct_message: false,
        recent_messages: recent,
        new_message: candidate.message,
      },
      questions: config.questions,
    });
    const { probabilities } = await deps.decide(request);
    return {
      relevant: isRelevant(config, probabilities),
      reason: 'decided',
      probabilities,
    };
  };

  try {
    return await ask(candidate.recent);
  } catch (first) {
    await deps.log({
      message_id: candidate.messageId,
      decide_error: String(first),
    });
    try {
      return await ask(candidate.recent.slice(-2));
    } catch (second) {
      // Losing a reply in the agent's own thread is worse than one extra wake.
      await deps.log({
        message_id: candidate.messageId,
        decide_error: String(second),
        fallback: 'in_my_thread',
      });
      return {
        relevant: candidate.inMyThread,
        reason: 'in_my_thread',
        probabilities: {},
      };
    }
  }
}

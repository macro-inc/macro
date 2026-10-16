import type {
  ActivityRow,
  FoldedMessage,
  TurnPhase,
} from '@service-agent-fold/generated/types';

/** The reply an agent is still writing; the latest when there are several. */
export function openReply(
  messages: readonly FoldedMessage[]
): FoldedMessage | undefined {
  return messages.findLast(
    (message) => message.author.kind === 'agent' && message.stop === null
  );
}

/** The agent's reply to `turn`: the reply a posted message's steps belong to. */
export function replyToTurn(
  messages: readonly FoldedMessage[],
  turn: number
): FoldedMessage | undefined {
  return messages.find(
    (message) => message.author.kind === 'agent' && message.turn === turn
  );
}

/**
 * The passage the agent is writing right now: the reply's last segment while
 * it is unfinished prose. A finished passage is posted as its own message, so
 * only this one streams live.
 */
export function streamingProse(reply: FoldedMessage): string | undefined {
  const last = reply.segments.at(-1);
  if (!last || last.kind !== 'prose' || last.sealed) return undefined;
  const text = reply.parts
    .slice(last.start, last.end)
    .flatMap((part) =>
      part.kind === 'text' && part.text.trim() ? [part.text.trim()] : []
    )
    .join('\n\n');
  return text || undefined;
}

/** The live rows of one activity segment, by the index the server posted. */
export function segmentRows(
  reply: FoldedMessage,
  segment: number
): ActivityRow[] | undefined {
  const found = reply.segments.find((candidate) => candidate.index === segment);
  return found?.kind === 'activity' ? found.rows : undefined;
}

const PHASE_VERBS: Record<TurnPhase, string> = {
  thinking: 'is thinking',
  writing: 'is typing',
  working: 'is working',
  waiting: 'is waiting for an answer',
};

/** What a typing indicator says an agent is doing. */
export function typingLabel(name: string, phase: TurnPhase): string {
  return `${name} ${PHASE_VERBS[phase]}`;
}

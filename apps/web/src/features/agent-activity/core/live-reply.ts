import type {
  ActivityRow,
  FoldedMessage,
  Segment,
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

/** The run of steps the agent is in the middle of, when it is in one. */
export function openRun(reply: FoldedMessage | undefined): Segment | undefined {
  const last = reply?.segments.at(-1);
  return last?.kind === 'activity' && !last.sealed ? last : undefined;
}

/** The live rows of one activity segment, by the index the server posted. */
export function segmentRows(
  reply: FoldedMessage,
  segment: number
): ActivityRow[] | undefined {
  const found = reply.segments.find((candidate) => candidate.index === segment);
  return found?.kind === 'activity' ? found.rows : undefined;
}

const PHASE_LINES: Record<TurnPhase, string> = {
  thinking: 'Thinking',
  writing: 'Writing',
  working: 'Working',
  waiting: 'Waiting for an answer',
};

/**
 * What a turn is doing, as a step: all its typing tells a viewer who cannot
 * read the session, and what a typing row says between runs.
 */
export function phaseRow(phase: TurnPhase): ActivityRow {
  return {
    id: phase,
    label: PHASE_LINES[phase],
    detail: null,
    status: 'running',
  };
}

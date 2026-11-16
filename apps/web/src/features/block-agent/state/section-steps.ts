/**
 * What a run of tool calls and thoughts says while the turn is in it: one
 * step per thing the agent did, worded by the session fold, for the run's
 * single live line to cycle through (`ActivityLine`).
 */

import type {
  ActivityRow,
  ActivityStatus,
  MessagePart,
} from '@service-agent-fold/generated/types';
import type { ExecutionActivity } from '@service-agent-harness/generated/schemas';
import { isCodeModeSupportCall } from './code-mode-support';
import { isCodeExecution } from './tool-groups';

export type SectionStep = {
  id: string;
  label: string;
  status: ActivityStatus;
};

/** The tail thought is still streaming. */
const THINKING: SectionStep = {
  id: 'thinking',
  label: 'Thinking',
  status: 'running',
};

/** Nothing in the run names itself yet: a call's arguments are on the way. */
const WORKING: SectionStep = {
  id: 'working',
  label: 'Working',
  status: 'running',
};

/**
 * The run's steps in the order they were taken, ending with `Thinking` when
 * the agent is reasoning at the tail. A call reads as its fold row, with what
 * it acted on, since only people who can read the session see this line. A
 * program reads as the operations its saved record has observed so far: its
 * receipt, and so its fold rows, only list them once it returns.
 */
export function sectionSteps(options: {
  /** The run's parts. */
  parts: readonly MessagePart[];
  /** Every activity row of the message, from its fold segments. */
  rows: readonly ActivityRow[];
  /** A program's observed operations, by its call id. */
  observed: (callId: string) => readonly ExecutionActivity[] | undefined;
  thinking: boolean;
}): SectionStep[] {
  const steps = options.parts.flatMap((part): SectionStep[] => {
    if (part.kind !== 'tool_use' || isCodeModeSupportCall(part)) return [];
    const observed = isCodeExecution(part)
      ? options.observed(part.id)
      : undefined;
    if (observed?.length) {
      return observed.map((operation) => ({
        id: `${part.id}:${operation.id}`,
        label: operation.label,
        status:
          operation.status === 'unknown' ? 'interrupted' : operation.status,
      }));
    }
    return options.rows
      .filter((row) => row.id === part.id || row.id.startsWith(`${part.id}:`))
      .map((row) => ({
        id: row.id,
        label: row.detail ? `${row.label} ${row.detail}` : row.label,
        status: row.status,
      }));
  });
  if (options.thinking) steps.push(THINKING);
  return steps.length > 0 ? steps : [WORKING];
}

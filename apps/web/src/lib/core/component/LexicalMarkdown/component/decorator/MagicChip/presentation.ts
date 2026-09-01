import type { MagicChipStatus } from '@macro-inc/lexical-core';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';

export type MagicChipActivity = {
  label: string;
  detail?: string;
  busy: boolean;
};

/**
 * The one state the chip renders.
 *
 * A running turn is always `working`: one fixed-height line, whatever the
 * agent is doing — narration included, carried as the activity's detail. The
 * chip only takes the height of real prose once the turn is over, so it never
 * grows and shrinks under the message while the agent works.
 */
export type MagicChipPresentation =
  | { kind: 'working'; activity: MagicChipActivity }
  | {
      kind: 'settled';
      markdown: string;
      /** How the turn ended, when it ended as anything but a clean answer. */
      activity?: MagicChipActivity;
    };

export type MagicChipPresentationInput = {
  persistedStatus: MagicChipStatus;
  /**
   * Freshest lifecycle event seen on the live log stream, as its wire string.
   * A stopgap for {@link persistedStatus} being a snapshot from when the chip
   * was written: same vocabulary, staler. Goes away when the server pushes
   * status transitions (see {@link liveEventActivity}).
   */
  latestEvent?: string;
  prompt?: FoldedMessage;
  response?: FoldedMessage;
};

function toolActivity(
  part: Extract<MessagePart, { kind: 'tool_use' }>
): MagicChipActivity {
  const busy = part.status === 'pending' || part.status === 'running';
  const failed = part.status === 'failed';
  return match(part.detail)
    .with({ kind: 'terminal' }, (detail) => ({
      label: failed
        ? 'Command failed'
        : busy
          ? 'Running command'
          : 'Command finished',
      detail: detail.command ?? part.label,
      busy,
    }))
    .with({ kind: 'edit' }, (detail) => ({
      label: failed ? 'Edit failed' : busy ? 'Editing files' : 'Files updated',
      detail: detail.diffs.at(-1)?.path ?? part.label,
      busy,
    }))
    .with({ kind: 'read' }, (detail) => ({
      label: failed
        ? 'Read failed'
        : busy
          ? 'Reading files'
          : 'Finished reading',
      detail: detail.paths.at(-1) ?? part.label,
      busy,
    }))
    .with(
      { kind: 'delete' },
      { kind: 'move' },
      { kind: 'search' },
      (detail) => ({
        label: failed ? `${part.label} failed` : part.label,
        detail: detail.paths.at(-1) ?? part.label,
        busy,
      })
    )
    .with({ kind: 'fetch' }, { kind: 'think' }, { kind: 'other' }, () => ({
      label: failed ? `${part.label} failed` : part.label,
      busy,
    }))
    .exhaustive();
}

function partActivity(part: MessagePart): MagicChipActivity {
  return match(part)
    .with({ kind: 'text' }, ({ text }) => ({
      label: 'Writing response',
      detail: text.trim() || undefined,
      busy: true,
    }))
    .with({ kind: 'thought' }, ({ text }) => ({
      label: 'Thinking',
      detail: text.trim() || undefined,
      busy: true,
    }))
    .with({ kind: 'tool_use' }, toolActivity)
    .with({ kind: 'permission', outcome: { kind: 'cancelled' } }, () => ({
      label: 'Permission cancelled',
      busy: false,
    }))
    .with({ kind: 'permission', outcome: { kind: 'selected' } }, () => ({
      label: 'Resuming work',
      busy: true,
    }))
    .with({ kind: 'permission', outcome: { kind: 'pending' } }, () => ({
      label: 'Permission needed',
      busy: false,
    }))
    .with({ kind: 'permission', outcome: { kind: 'errored' } }, () => ({
      label: 'Permission failed',
      busy: false,
    }))
    .with({ kind: 'permission', outcome: { kind: 'unrecognized' } }, () => ({
      label: 'Permission unavailable',
      busy: false,
    }))
    .with({ kind: 'control', control: { kind: 'set_model' } }, (part) => ({
      label: 'Model changed',
      detail: part.control.model,
      busy: false,
    }))
    .with({ kind: 'control', control: { kind: 'compact' } }, () => ({
      label: 'Context compacted',
      busy: false,
    }))
    .with({ kind: 'control', control: { kind: 'stop' } }, () => ({
      label: 'Stop requested',
      busy: false,
    }))
    .with({ kind: 'plan' }, ({ entries }) => {
      const completed = entries.filter(
        (entry) => entry.status === 'completed'
      ).length;
      const current = entries.find((entry) => entry.status === 'in_progress');
      return {
        label: `Todos ${completed}/${entries.length}`,
        detail: current?.content,
        busy: completed < entries.length,
      };
    })
    .exhaustive();
}

/** How the turn ended, when it has — every ending but a clean answer. */
function turnEndedActivity(
  response: FoldedMessage | undefined
): MagicChipActivity | undefined {
  const stop = response?.stop;
  if (!stop) return undefined;
  return (
    match(stop)
      .with({ kind: 'end_turn' }, () => ({
        // A clean end with prose settles before activity is consulted, so
        // reaching this arm means the agent closed the turn empty-handed.
        label: 'Agent finished without a response',
        busy: false,
      }))
      .with({ kind: 'cancelled' }, () => ({ label: 'Stopped', busy: false }))
      .with({ kind: 'refusal' }, () => ({
        label: 'Request refused',
        busy: false,
      }))
      .with({ kind: 'max_tokens' }, () => ({
        label: 'Response limit reached',
        busy: false,
      }))
      .with({ kind: 'max_turn_requests' }, () => ({
        label: 'Turn limit reached',
        busy: false,
      }))
      .with({ kind: 'other' }, ({ reason }) => ({ label: reason, busy: false }))
      // The runtime errored the prompt. The chip has one line, so it says that
      // much and leaves the runtime's message to the session itself.
      .with({ kind: 'failed' }, () => ({
        label: "Agent couldn't answer",
        busy: false,
      }))
      .exhaustive()
  );
}

/**
 * What the agent is doing right now, from the parts of an open turn: an
 * unanswered permission request outranks a running tool, which outranks
 * whatever arrived last.
 */
function turnInFlightActivity(
  response: FoldedMessage | undefined
): MagicChipActivity | undefined {
  if (!response) return undefined;
  const blocked = response.parts.findLast(
    (part) =>
      part.kind === 'permission' &&
      (part.outcome.kind === 'pending' ||
        part.outcome.kind === 'errored' ||
        part.outcome.kind === 'unrecognized')
  );
  const runningTool = response.parts.findLast(
    (part) =>
      part.kind === 'tool_use' &&
      (part.status === 'pending' || part.status === 'running')
  );
  // The fold never derives a message with no parts, so an existing response
  // always has a latest part to describe.
  const latest = response.parts.at(-1);
  return partActivity((blocked ?? runningTool ?? latest)!);
}

/** The session's persisted lifecycle, when the fold has nothing livelier. */
function statusActivity(status: MagicChipStatus): MagicChipActivity {
  return match(status)
    .with('no_messages', () => ({ label: 'Starting session', busy: false }))
    .with('booting', () => ({
      label: 'Booting agent',
      detail: 'Preparing workspace',
      busy: true,
    }))
    .with('acp_ready', () => ({ label: 'Waiting for harness', busy: true }))
    .with('shutting_down', () => ({ label: 'Wrapping up', busy: false }))
    .with('disconnected', () => ({
      label: 'Session disconnected',
      busy: false,
    }))
    .exhaustive();
}

/**
 * Lifecycle read off the live log stream — the fresher twin of two
 * {@link statusActivity} arms, and the file's one dependence on raw log
 * frames. Both callers delete together once the server pushes status
 * transitions and `latestEvent` leaves the input.
 */
function liveEventActivity(
  latestEvent: string | undefined,
  name: 'disconnected' | 'acp_ready'
): MagicChipActivity | undefined {
  if (latestEvent !== name) return undefined;
  return statusActivity(name);
}

/**
 * The agent's latest prose, which is the trailing text part and only that.
 *
 * The fold coalesces streamed chunks into the trailing text part, so a text
 * part that is no longer last is something the agent said and then moved on
 * from — narration before a tool call, not the turn's answer. Only the last
 * one is the answer, and only a finished turn has one.
 */
function answerMarkdown(response: FoldedMessage | undefined): string {
  const latest = response?.parts.at(-1);
  if (latest?.kind !== 'text' || !latest.text.trim()) return '';
  return latest.text;
}

/** Project fold and lifecycle facts into the one state the view renders. */
export function deriveMagicChipPresentation(
  input: MagicChipPresentationInput
): MagicChipPresentation {
  const { response, prompt, latestEvent, persistedStatus } = input;

  // Only a finished turn earns the chip's full height, and every ending
  // qualifies: a turn cut short still leaves prose worth reading, with the
  // reason it stopped kept underneath.
  const markdown = answerMarkdown(response);
  if (response?.stop && markdown) {
    return {
      kind: 'settled',
      markdown,
      ...(response.stop.kind === 'end_turn'
        ? {}
        : { activity: turnEndedActivity(response) }),
    };
  }

  // Best available answer first: how the turn ended, then what it is doing,
  // then that it exists at all, then the session's lifecycle — live before
  // persisted.
  const activity =
    turnEndedActivity(response) ??
    liveEventActivity(latestEvent, 'disconnected') ??
    turnInFlightActivity(response) ??
    (prompt ? { label: 'Waiting for agent', busy: true } : undefined) ??
    liveEventActivity(latestEvent, 'acp_ready') ??
    statusActivity(persistedStatus);

  return { kind: 'working', activity };
}

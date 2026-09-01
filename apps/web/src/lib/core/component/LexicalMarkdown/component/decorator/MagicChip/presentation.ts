import type { MagicChipStatus } from '@macro-inc/lexical-core';
import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';

/**
 * What the pill draws on the left. Closed so a new activity has to pick one.
 * Labels stay for the opened/inline line and for the pill's accessible name.
 */
export type MagicChipActivityIcon =
  | 'boot'
  | 'think'
  | 'wait'
  | 'write'
  | 'terminal'
  | 'edit'
  | 'read'
  | 'search'
  | 'permission'
  | 'plan'
  | 'stop'
  | 'error'
  | 'disconnect'
  | 'gear';

export type MagicChipActivity = {
  icon: MagicChipActivityIcon;
  label: string;
  detail?: string;
  busy: boolean;
};

/**
 * The one state the chip renders.
 *
 * Four: hydrating already-written session data, an activity line while the
 * agent works with nothing to show, the answer as it is written with the
 * activity line still under it, and the answer alone once the turn ends.
 */
export type MagicChipPresentation =
  | { kind: 'loading' }
  | { kind: 'working'; activity: MagicChipActivity }
  | { kind: 'answering'; markdown: string; activity: MagicChipActivity }
  | { kind: 'settled'; markdown: string };

/** Fold has not arrived yet. Not the same as a live boot. */
export const MAGIC_CHIP_LOADING_ACTIVITY: MagicChipActivity = {
  icon: 'wait',
  label: 'Loading session',
  busy: true,
};

export type MagicChipPresentationInput = {
  /** False until the session fold has been acquired. */
  foldReady: boolean;
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
      icon: 'terminal',
      label: failed
        ? 'Command failed'
        : busy
          ? 'Running command'
          : 'Command finished',
      detail: detail.command ?? part.label,
      busy,
    }))
    .with({ kind: 'edit' }, (detail) => ({
      icon: 'edit',
      label: failed ? 'Edit failed' : busy ? 'Editing files' : 'Files updated',
      detail: detail.diffs.at(-1)?.path ?? part.label,
      busy,
    }))
    .with({ kind: 'read' }, (detail) => ({
      icon: 'read',
      label: failed
        ? 'Read failed'
        : busy
          ? 'Reading files'
          : 'Finished reading',
      detail: detail.paths.at(-1) ?? part.label,
      busy,
    }))
    .with({ kind: 'delete' }, { kind: 'move' }, (detail) => ({
      icon: 'edit',
      label: failed ? `${part.label} failed` : part.label,
      detail: detail.paths.at(-1) ?? part.label,
      busy,
    }))
    .with({ kind: 'search' }, (detail) => ({
      icon: 'search',
      label: failed ? `${part.label} failed` : part.label,
      detail: detail.paths.at(-1) ?? part.label,
      busy,
    }))
    .with({ kind: 'fetch' }, () => ({
      icon: 'wait',
      label: failed ? `${part.label} failed` : part.label,
      busy,
    }))
    .with({ kind: 'think' }, () => ({
      icon: 'think',
      label: failed ? `${part.label} failed` : part.label,
      busy,
    }))
    .with({ kind: 'other' }, () => ({
      icon: 'gear',
      label: failed ? `${part.label} failed` : part.label,
      busy,
    }))
    .exhaustive();
}

function partActivity(part: MessagePart): MagicChipActivity {
  return match(part)
    .with({ kind: 'text' }, () => ({
      icon: 'write',
      label: 'Writing response',
      busy: false,
    }))
    .with({ kind: 'thought' }, ({ text }) => ({
      icon: 'think',
      label: 'Thinking',
      detail: text.trim() || undefined,
      busy: true,
    }))
    .with({ kind: 'tool_use' }, toolActivity)
    .with({ kind: 'permission', outcome: { kind: 'cancelled' } }, () => ({
      icon: 'stop',
      label: 'Permission cancelled',
      busy: false,
    }))
    .with({ kind: 'permission', outcome: { kind: 'selected' } }, () => ({
      icon: 'wait',
      label: 'Resuming work',
      busy: true,
    }))
    .with({ kind: 'permission', outcome: { kind: 'pending' } }, () => ({
      icon: 'permission',
      label: 'Permission needed',
      busy: false,
    }))
    .with({ kind: 'permission', outcome: { kind: 'errored' } }, () => ({
      icon: 'error',
      label: 'Permission failed',
      busy: false,
    }))
    .with({ kind: 'permission', outcome: { kind: 'unrecognized' } }, () => ({
      icon: 'error',
      label: 'Permission unavailable',
      busy: false,
    }))
    .with({ kind: 'control', control: { kind: 'set_model' } }, (part) => ({
      icon: 'gear',
      label: 'Model changed',
      detail: part.control.model,
      busy: false,
    }))
    .with({ kind: 'control', control: { kind: 'compact' } }, () => ({
      icon: 'gear',
      label: 'Context compacted',
      busy: false,
    }))
    .with({ kind: 'control', control: { kind: 'stop' } }, () => ({
      icon: 'stop',
      label: 'Stop requested',
      busy: false,
    }))
    .with({ kind: 'plan' }, ({ entries }) => {
      const completed = entries.filter(
        (entry) => entry.status === 'completed'
      ).length;
      const current = entries.find((entry) => entry.status === 'in_progress');
      return {
        icon: 'plan',
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
        icon: 'stop',
        label: 'Agent finished without a response',
        busy: false,
      }))
      .with({ kind: 'cancelled' }, () => ({
        icon: 'stop',
        label: 'Stopped',
        busy: false,
      }))
      .with({ kind: 'refusal' }, () => ({
        icon: 'error',
        label: 'Request refused',
        busy: false,
      }))
      .with({ kind: 'max_tokens' }, () => ({
        icon: 'error',
        label: 'Response limit reached',
        busy: false,
      }))
      .with({ kind: 'max_turn_requests' }, () => ({
        icon: 'error',
        label: 'Turn limit reached',
        busy: false,
      }))
      .with({ kind: 'other' }, ({ reason }) => ({
        icon: 'error',
        label: reason,
        busy: false,
      }))
      // The runtime errored the prompt. The chip has one line, so it says that
      // much and leaves the runtime's message to the session itself.
      .with({ kind: 'failed' }, () => ({
        icon: 'error',
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
    .with('no_messages', () => ({
      icon: 'wait',
      label: 'Starting session',
      busy: false,
    }))
    .with('booting', () => ({
      icon: 'boot',
      label: 'Booting agent',
      detail: 'Preparing workspace',
      busy: true,
    }))
    .with('acp_ready', () => ({
      icon: 'wait',
      label: 'Waiting for harness',
      busy: true,
    }))
    .with('shutting_down', () => ({
      icon: 'stop',
      label: 'Wrapping up',
      busy: false,
    }))
    .with('disconnected', () => ({
      icon: 'disconnect',
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
 * The latest agent utterance in the turn.
 *
 * Streaming chunks append into the trailing text part, so one part is one
 * message. A later text part is a later message — after a tool, or another
 * agent bubble in the same turn. Joining them would replay the first reply
 * under every addition.
 */
function answerMarkdown(response: FoldedMessage | undefined): string {
  const latest = response?.parts.findLast(
    (part): part is Extract<MessagePart, { kind: 'text' }> =>
      part.kind === 'text' && Boolean(part.text.trim())
  );
  return latest?.text ?? '';
}

/** Project fold and lifecycle facts into the one state the view renders. */
export function deriveMagicChipPresentation(
  input: MagicChipPresentationInput
): MagicChipPresentation {
  if (!input.foldReady) return { kind: 'loading' };

  const { response, prompt, latestEvent, persistedStatus } = input;

  const markdown = answerMarkdown(response);
  if (response?.stop?.kind === 'end_turn' && markdown) {
    return { kind: 'settled', markdown };
  }

  // Best available answer first: how the turn ended, then what it is doing,
  // then that it exists at all, then the session's lifecycle — live before
  // persisted.
  const activity =
    turnEndedActivity(response) ??
    liveEventActivity(latestEvent, 'disconnected') ??
    turnInFlightActivity(response) ??
    (prompt
      ? { icon: 'wait', label: 'Waiting for agent', busy: true }
      : undefined) ??
    liveEventActivity(latestEvent, 'acp_ready') ??
    statusActivity(persistedStatus);

  // Latest prose the turn has not closed on yet. Chunks append into the
  // trailing text part, so this is the message being written; activity
  // stays alongside it between sentences.
  if (markdown) return { kind: 'answering', markdown, activity };

  return { kind: 'working', activity };
}

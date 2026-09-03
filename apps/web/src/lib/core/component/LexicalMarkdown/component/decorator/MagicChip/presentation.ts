import type { MagicChipStatus } from '@macro-inc/lexical-core';
import type {
  FoldedMessage,
  MessagePart,
  ToolName,
} from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';

/** The tool's own name, without its MCP server namespace. */
function toolLabel(name: ToolName): string {
  return name.kind === 'mcp' ? name.tool : name.name;
}

export type MagicChipActivity = {
  label: string;
  detail?: string;
  busy: boolean;
};

/**
 * The one state the chip renders.
 *
 * Three, in the order a turn passes through them: an activity line while the
 * agent works with nothing to show, the answer as it is written with the
 * activity line still under it, and the answer alone once the turn ends.
 */
export type MagicChipPresentation =
  | { kind: 'working'; activity: MagicChipActivity }
  | { kind: 'answering'; markdown: string; activity: MagicChipActivity }
  | { kind: 'settled'; markdown: string };

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
  const label = toolLabel(part.name);
  return match(part.detail)
    .with({ kind: 'terminal' }, (detail) => ({
      label: failed
        ? 'Command failed'
        : busy
          ? 'Running command'
          : 'Command finished',
      detail: detail.command ?? label,
      busy,
    }))
    .with({ kind: 'edit' }, (detail) => ({
      label: failed ? 'Edit failed' : busy ? 'Editing files' : 'Files updated',
      detail: detail.diffs.at(-1)?.path ?? label,
      busy,
    }))
    .with({ kind: 'read' }, (detail) => ({
      label: failed
        ? 'Read failed'
        : busy
          ? 'Reading files'
          : 'Finished reading',
      detail: detail.paths.at(-1) ?? label,
      busy,
    }))
    .with(
      { kind: 'delete' },
      { kind: 'move' },
      { kind: 'search' },
      (detail) => ({
        label: failed ? `${label} failed` : label,
        detail: detail.paths.at(-1) ?? label,
        busy,
      })
    )
    .with({ kind: 'fetch' }, { kind: 'think' }, { kind: 'other' }, () => ({
      label: failed ? `${label} failed` : label,
      busy,
    }))
    .with({ kind: 'macro' }, () => ({
      label: failed ? `${label} failed` : busy ? `Using ${label}` : label,
      busy,
    }))
    .with({ kind: 'user_tool' }, (detail) => ({
      label:
        detail.outcome.kind === 'pending'
          ? `${label} drafted`
          : `${label} ${detail.outcome.kind.replace('_', ' ')}`,
      busy: false,
    }))
    .with({ kind: 'subagent' }, (detail) => {
      // What the subagent is doing right now says more than that it exists.
      const child = detail.children.findLast(
        (child) =>
          child.kind === 'tool_use' &&
          (child.status === 'pending' || child.status === 'running')
      );
      if (busy && child?.kind === 'tool_use') return toolActivity(child);
      return {
        label: failed
          ? 'Subagent failed'
          : busy
            ? 'Delegating work'
            : 'Subagent finished',
        detail: detail.title,
        busy,
      };
    })
    .exhaustive();
}

function partActivity(part: MessagePart): MagicChipActivity {
  return match(part)
    .with({ kind: 'text' }, () => ({ label: 'Writing response', busy: false }))
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

function answerMarkdown(response: FoldedMessage | undefined): string {
  return (
    response?.parts
      .filter(
        (part): part is Extract<MessagePart, { kind: 'text' }> =>
          part.kind === 'text' && Boolean(part.text.trim())
      )
      .map((part) => part.text)
      .join('\n\n') ?? ''
  );
}

/** Project fold and lifecycle facts into the one state the view renders. */
export function deriveMagicChipPresentation(
  input: MagicChipPresentationInput
): MagicChipPresentation {
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
    (prompt ? { label: 'Waiting for agent', busy: true } : undefined) ??
    liveEventActivity(latestEvent, 'acp_ready') ??
    statusActivity(persistedStatus);

  // Prose the turn has not closed on yet. The fold appends into the trailing
  // text part as chunks land, so this is the answer being written, and the
  // activity stays alongside it to say what the agent is doing between
  // sentences.
  if (markdown) return { kind: 'answering', markdown, activity };

  return { kind: 'working', activity };
}

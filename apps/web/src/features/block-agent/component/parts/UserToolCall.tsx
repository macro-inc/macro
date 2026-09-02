/**
 * A Macro user tool: the agent drafted it, the user finishes it after the
 * turn. Shows the draft and where the user got to with it.
 *
 * Read-only for now. The session-side API that lets the user edit, send, or
 * reject from here — the chat block's `callTool` loop — is a follow-up; when
 * it lands, this card mounts the compose surface on a pending outcome.
 */

import type {
  ToolDetail,
  UserToolOutcome,
} from '@service-agent-fold/generated/types';
import { type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { FoldedOutput, ToolCard } from '../../ui';
import type { ToolCallCommon } from './shared';

type UserToolDetail = Extract<ToolDetail, { kind: 'user_tool' }>;

/** The one-line reading of an outcome, for the row's trailing slot. */
function outcomeLabel(outcome: UserToolOutcome): string {
  return match(outcome)
    .with({ kind: 'pending' }, () => 'Awaiting you')
    .with({ kind: 'edited' }, () => 'Edited')
    .with({ kind: 'sent' }, () => 'Sent')
    .with({ kind: 'draft' }, () => 'Saved as draft')
    .with({ kind: 'completed' }, () => 'Done')
    .with({ kind: 'rejected' }, () => 'Rejected')
    .with({ kind: 'failed' }, () => 'Failed')
    .with({ kind: 'unrecognized' }, () => 'Answered')
    .exhaustive();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function recipients(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const labels = value
    .map((entry) => {
      const record = asRecord(entry);
      const name = record?.name;
      const email = record?.email;
      return typeof name === 'string' && name.trim()
        ? name
        : typeof email === 'string'
          ? email
          : undefined;
    })
    .filter((label): label is string => label !== undefined);
  return labels.length > 0 ? labels.join(', ') : undefined;
}

/** What to show in the row for a draft, by tool. */
function draftSubtitle(tool: string, input: unknown): string | undefined {
  const record = asRecord(input);
  if (!record) return undefined;
  if (tool === 'SendEmail') {
    const to = recipients(record.to);
    const subject =
      typeof record.subject === 'string' ? record.subject : undefined;
    return [to && `To ${to}`, subject].filter(Boolean).join(' · ') || undefined;
  }
  if (tool === 'CreateCalendarEvent') {
    return typeof record.title === 'string' ? record.title : undefined;
  }
  return undefined;
}

/** The draft's body text, when the tool has one. */
function draftBody(tool: string, input: unknown): string | undefined {
  const record = asRecord(input);
  if (!record) return undefined;
  if (tool === 'SendEmail' && typeof record.body === 'string') {
    return record.body;
  }
  if (tool === 'CreateCalendarEvent') {
    const description = record.description;
    return typeof description === 'string' ? description : undefined;
  }
  return JSON.stringify(input, null, 2);
}

export function UserToolCall(props: {
  detail: UserToolDetail;
  common: ToolCallCommon;
}): JSX.Element {
  const failure = () =>
    props.detail.outcome.kind === 'failed'
      ? props.detail.outcome.message
      : undefined;
  const body = () =>
    failure() ?? draftBody(props.common.label, props.detail.input);

  return (
    <ToolCard
      title={props.common.label}
      subtitle={draftSubtitle(props.common.label, props.detail.input)}
      status={props.common.status}
      muted={props.common.muted || props.detail.outcome.kind === 'failed'}
      trailing={
        props.common.trailing ?? (
          <span class="text-ink">{outcomeLabel(props.detail.outcome)}</span>
        )
      }
    >
      <Show when={body()}>{(text) => <FoldedOutput text={text()} />}</Show>
    </ToolCard>
  );
}

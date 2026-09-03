/**
 * The agent asking the user a question.
 *
 * Interactive only while the fold's metadata still names this question as the
 * one to answer: a `pending` part on a turn that has ended, or on a dead
 * connection, reads as "not answered" rather than offering a form the agent
 * is no longer waiting on. Resolved parts read back what was chosen.
 *
 * URL mode never opens anything on its own. The card shows the full URL and
 * its host, warns on punycode, and only after the user presses Open does it
 * send the consent and open a new tab - never an iframe, never a prefetch.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { Button } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { match } from 'ts-pattern';
import { useAgentSession } from '../../context/AgentSessionContext';
import {
  describeContent,
  type FieldValue,
  initialValues,
  looksSuspicious,
  toContent,
  urlHost,
  validate,
} from '../../state/elicitation-form';
import { ElicitationForm, ToolCard } from '../../ui';

type ElicitationPartData = Extract<MessagePart, { kind: 'elicitation' }>;

function outcomeLabel(part: ElicitationPartData): string {
  return match(part.outcome)
    .with({ kind: 'pending' }, () => 'Not answered')
    .with({ kind: 'accepted' }, () =>
      part.request.kind === 'url' ? 'Opened' : 'Answered'
    )
    .with({ kind: 'declined' }, () => 'Declined')
    .with({ kind: 'cancelled' }, () => 'Cancelled')
    .with({ kind: 'completed' }, () => 'Finished')
    .with({ kind: 'errored' }, () => 'Refused')
    .with({ kind: 'unrecognized' }, () => 'Answered')
    .exhaustive();
}

export function ElicitationPart(props: { part: ElicitationPartData }) {
  const { elicitation, bot } = useAgentSession();

  // Live only while the metadata slot names this exact request.
  const live = () =>
    props.part.outcome.kind === 'pending' &&
    elicitation.pending()?.requestId === props.part.requestId;

  const agentName = () => bot()?.name ?? 'The agent';

  return (
    <Show when={live()} fallback={<ResolvedElicitation part={props.part} />}>
      <ToolCard
        title={`${agentName()} is asking`}
        status="running"
        defaultOpen
        trailing={<span class="text-ink-muted">Waiting for you</span>}
      >
        <div class="flex flex-col gap-3 py-1">
          <div class="text-sm text-ink">{props.part.message}</div>
          {match(props.part.request)
            .with({ kind: 'form' }, (request) => (
              <LiveForm
                schema={request.schema}
                answering={elicitation.answering()}
                onRespond={elicitation.respond}
              />
            ))
            .with({ kind: 'url' }, (request) => (
              <LiveUrl
                url={request.url}
                answering={elicitation.answering()}
                onRespond={elicitation.respond}
              />
            ))
            .with({ kind: 'unrecognized' }, (request) => (
              <div class="flex flex-col gap-2">
                <div class="text-xs text-ink-extra-muted italic">
                  This client cannot display a "{request.mode}" request.
                </div>
                <DeclineCancel
                  answering={elicitation.answering()}
                  onRespond={elicitation.respond}
                />
              </div>
            ))
            .exhaustive()}
        </div>
      </ToolCard>
    </Show>
  );
}

function DeclineCancel(props: {
  answering: boolean;
  onRespond: (answer: { action: 'decline' } | { action: 'cancel' }) => unknown;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        disabled={props.answering}
        onClick={() => props.onRespond({ action: 'decline' })}
      >
        Decline
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={props.answering}
        onClick={() => props.onRespond({ action: 'cancel' })}
      >
        Cancel
      </Button>
    </>
  );
}

function LiveForm(props: {
  schema: Extract<ElicitationPartData['request'], { kind: 'form' }>['schema'];
  answering: boolean;
  onRespond: (answer: {
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, unknown>;
  }) => unknown;
}) {
  const [values, setValues] = createStore(initialValues(props.schema));
  const [touched, setTouched] = createSignal(false);
  const errors = createMemo(() => validate(props.schema, values));
  const shownErrors = () => (touched() ? errors() : {});

  const submit = () => {
    setTouched(true);
    if (Object.keys(errors()).length > 0) return;
    props.onRespond({
      action: 'accept',
      content: toContent(props.schema, values),
    });
  };

  return (
    <div class="flex flex-col gap-3">
      <ElicitationForm
        schema={props.schema}
        values={values}
        errors={shownErrors()}
        disabled={props.answering}
        onChange={(name: string, value: FieldValue) => setValues(name, value)}
      />
      <div class="flex items-center gap-2">
        <Button
          variant="cta"
          size="xs"
          disabled={props.answering}
          onClick={submit}
        >
          Submit
        </Button>
        <DeclineCancel
          answering={props.answering}
          onRespond={props.onRespond}
        />
      </div>
    </div>
  );
}

function LiveUrl(props: {
  url: string;
  answering: boolean;
  onRespond: (answer: {
    action: 'accept' | 'decline' | 'cancel';
  }) => Promise<boolean> | unknown;
}) {
  const host = () => urlHost(props.url);
  const open = async () => {
    // Consent goes to the agent first so it learns the user agreed even if
    // the popup is blocked; the link below stays as the fallback.
    const accepted = await props.onRespond({ action: 'accept' });
    if (accepted === false) return;
    window.open(props.url, '_blank', 'noopener,noreferrer');
  };
  return (
    <div class="flex flex-col gap-2">
      <div class="text-xs text-ink-muted">
        Opens <span class="font-medium text-ink">{host()}</span> in a new tab.
      </div>
      <div class="rounded-md border border-edge-muted bg-surface px-2 py-1 font-mono text-xs text-ink-muted break-all">
        {props.url}
      </div>
      <Show when={looksSuspicious(props.url)}>
        <div class="text-xs text-failure">
          This address uses an encoded (punycode) domain. Check it carefully
          before opening.
        </div>
      </Show>
      <div class="flex items-center gap-2">
        <Button
          variant="cta"
          size="xs"
          disabled={props.answering}
          onClick={open}
        >
          Open
        </Button>
        <DeclineCancel
          answering={props.answering}
          onRespond={props.onRespond}
        />
      </div>
    </div>
  );
}

function ResolvedElicitation(props: { part: ElicitationPartData }) {
  const lines = () =>
    match(props.part)
      .with(
        { request: { kind: 'form' }, outcome: { kind: 'accepted' } },
        (part) => describeContent(part.request.schema, part.outcome.content)
      )
      .otherwise(() => []);
  const reported = () => {
    const value = props.part.reported;
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value as Record<string, unknown>).map(
      ([question, answer]) => ({ label: question, value: String(answer) })
    );
  };
  const refusal = () =>
    props.part.outcome.kind === 'errored'
      ? props.part.outcome.message
      : undefined;
  // The harness's own reading outranks what we sent: it is what the agent
  // actually acted on.
  const shown = () => (reported().length > 0 ? reported() : lines());

  return (
    <ToolCard
      title="Question"
      subtitle={props.part.message}
      status={props.part.outcome.kind === 'errored' ? 'failed' : 'completed'}
      muted={props.part.outcome.kind === 'errored'}
      trailing={<span class="text-ink">{outcomeLabel(props.part)}</span>}
    >
      <Show when={shown().length > 0 || refusal()}>
        <div class="flex flex-col gap-2 py-1">
          <For each={shown()}>
            {(line) => (
              <div class="flex min-w-0 flex-col gap-0.5">
                <div class="text-xs text-ink-muted">{line.label}</div>
                <div class="text-sm text-ink wrap-break-word">{line.value}</div>
              </div>
            )}
          </For>
          <Show when={refusal()}>
            {(message) => <div class="text-xs text-failure">{message()}</div>}
          </Show>
        </div>
      </Show>
    </ToolCard>
  );
}

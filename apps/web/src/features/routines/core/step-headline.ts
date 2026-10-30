import { match } from 'ts-pattern';
import {
  type ChooseStepDraft,
  flattenSteps,
  type StepDraft,
  type ToolStepDraft,
} from './routine-steps';
import {
  actionLabel,
  describeChoice,
  pickAction,
  priorityOptions,
  type StepScope,
  type StepSubject,
  senderPolicies,
  singleValued,
  statusOptions,
  stepActionKey,
  triggerFields,
} from './step-catalog';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** A field a text argument embeds, e.g. `{{trigger.email.subject}}`. */
export const FIELD_PATTERN = /\{\{[^{}]+\}\}/g;

const allTriggerFields = (['email', 'channel', 'task'] as const).flatMap(
  (subject) => triggerFields(subject)
);

/** A field as people read it, e.g. "Email subject". */
export function fieldLabel(value: string, scope?: StepScope): string {
  const known =
    scope?.outputs.find((output) => output.value === value) ??
    allTriggerFields.find((field) => field.value === value);
  if (known) return known.label;
  const [root, ...path] = value.slice(2, -2).trim().split('.');
  const words = root === 'steps' ? path : path.length ? path : [root ?? ''];
  return words.join(' ').replace(/_/g, ' ');
}

/** Text with each field named, e.g. "Pay: Email subject". */
export function readableText(value: string, scope?: StepScope): string {
  return value.replace(FIELD_PATTERN, (field) => fieldLabel(field, scope));
}

const firstLine = (value: string) => value.trim().split('\n')[0]?.trim() ?? '';

/** A tool step's value in a few words: its label, status, title or text. */
function toolValue(step: ToolStepDraft): string {
  const args = step.arguments;
  const option = (options: readonly { id: string; label: string }[]) =>
    options.find((option) => option.id === args.option_id)?.label ?? '';
  return match(stepActionKey(step))
    .returnType<string>()
    .with('add_label', 'remove_label', () => text(args.label))
    .with(
      'sender_policy',
      () =>
        senderPolicies.find((policy) => policy.id === args.policy)?.label ?? ''
    )
    .with('set_status', () => option(statusOptions))
    .with('set_priority', () => option(priorityOptions))
    .with('assign', () => {
      const [ref] = Array.isArray(args.entity_refs)
        ? (args.entity_refs as { entityId?: unknown }[])
        : [];
      return text(ref?.entityId).replace(/^macro\|/, '');
    })
    .with('create_task', 'create_document', () =>
      readableText(text(args.documentName))
    )
    .with('comment', 'send_message', 'reply_in_thread', () =>
      firstLine(readableText(text(args.content)))
    )
    .with(
      'archive',
      'mark_read',
      'star',
      'mark_important',
      'add_tag',
      'move',
      'other',
      () => ''
    )
    .exhaustive();
}

/** How a choice runs its options, when it could run several. */
export function choiceMode(step: ChooseStepDraft): string | undefined {
  const key = pickAction(step);
  if (key && singleValued(key)) return undefined;
  return step.multiple ? 'All that apply' : 'Best match';
}

/**
 * A closed step's line: its name, then what it is set to, e.g. "Add label"
 * then "Finance". A choice also names how it runs its options.
 */
export function stepHeadline(step: StepDraft): {
  title: string;
  summary: string;
  mode?: string;
} {
  return match(step)
    .returnType<{ title: string; summary: string; mode?: string }>()
    .with({ kind: 'agent' }, (step) => ({
      title: 'Ask AI',
      summary: firstLine(step.instructions),
    }))
    .with({ kind: 'if' }, (step) => ({
      title: 'If',
      summary: step.condition.trim(),
    }))
    .with({ kind: 'choose' }, (step) => {
      const labels = step.options
        .map((option) => option.label.trim())
        .filter(Boolean)
        .join(' · ');
      return pickAction(step)
        ? {
            title: describeChoice(step),
            summary: labels,
            mode: choiceMode(step),
          }
        : {
            title: 'Choose',
            summary: step.question.trim() || labels,
            mode: choiceMode(step),
          };
    })
    .with({ kind: 'tool' }, (step) => ({
      title: actionLabel(step),
      summary: toolValue(step),
    }))
    .exhaustive();
}

/**
 * AI calls one run makes: one classifier call answers every decision, and a
 * run reaches at most one agent.
 */
export function aiCallsPerRun(steps: StepDraft[]): number {
  const all = flattenSteps(steps);
  return (
    (all.some((step) => step.kind === 'if' || step.kind === 'choose') ? 1 : 0) +
    (all.some((step) => step.kind === 'agent') ? 1 : 0)
  );
}

/** What one run is about, for "per email" and similar. */
export function subjectNoun(subject: StepSubject | undefined): string {
  return match(subject)
    .with('channel', () => 'message')
    .with(undefined, () => 'run')
    .otherwise((subject) => subject);
}

import CheckCircle from '@phosphor/check-circle.svg';
import Lock from '@phosphor/lock.svg';
import Prohibit from '@phosphor/prohibit.svg';
import { Button, cn } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { displayDate } from '../../core/date-answers';
import type {
  FormCellValue,
  FormColumn,
  FormEntityReference,
  FormOptionReference,
  FormQuestion,
  QuestionWidget,
} from '../../core/form-model';

/** "Section 1 of 3" with a bar. */
export function ProgressStrip(props: { position: number; total: number }) {
  return (
    <div class="flex flex-col gap-1.5" aria-label="Progress">
      <p class="text-xs font-medium text-ink-muted">
        Section {props.position} of {props.total}
      </p>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={props.total}
        aria-valuenow={props.position}
        aria-valuetext={`Section ${props.position} of ${props.total}`}
        class="h-1 overflow-hidden rounded-full bg-active"
      >
        <div
          class="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
          style={{
            width: `${(props.position / Math.max(props.total, 1)) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

/** The form's own card on the respond page. */
export function RespondTitleCard(props: {
  name: string;
  description: string;
  compact: boolean;
}) {
  return (
    <div
      class={
        props.compact
          ? 'overflow-hidden rounded-xl border border-edge bg-surface'
          : undefined
      }
    >
      <div class={cn('flex flex-col', props.compact ? 'gap-1.5 p-3' : 'gap-6')}>
        <h1
          class={cn(
            'font-semibold text-ink wrap-anywhere',
            props.compact ? 'text-base' : 'text-2xl'
          )}
        >
          {props.name}
        </h1>
        <Show when={props.description}>
          <p
            class={cn(
              'whitespace-pre-wrap text-ink-muted wrap-anywhere',
              props.compact ? 'text-sm' : 'text-base leading-relaxed'
            )}
          >
            {props.description}
          </p>
        </Show>
      </div>
    </div>
  );
}

/** A section's own heading between the title card and its questions. */
export function SectionHeading(props: { title: string; description: string }) {
  return (
    <Show when={props.title || props.description}>
      <div class="flex flex-col gap-0.5 px-1">
        <Show when={props.title}>
          <h2 class="text-base font-semibold text-ink wrap-anywhere">
            {props.title}
          </h2>
        </Show>
        <Show when={props.description}>
          <p class="text-sm text-ink-muted wrap-anywhere">
            {props.description}
          </p>
        </Show>
      </div>
    </Show>
  );
}

/** What a gate shows: its message, never its rules. */
export function StopScreen(props: {
  message: string;
  /** Stopped while editing a saved response, which stays as it was. */
  editing: boolean;
  onCheckAnswers: () => void;
  onMessageOwner?: () => void;
}) {
  return (
    <div
      role="alert"
      class="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-5"
    >
      <p class="flex items-center gap-2 text-xs font-semibold tracking-wide text-failure-ink uppercase">
        <Prohibit class="size-4" aria-hidden="true" />
        This form can’t take your response
      </p>
      <p class="text-base whitespace-pre-wrap text-ink wrap-anywhere">
        {props.message || 'Your answers don’t meet this form’s requirements.'}
      </p>
      <p class="text-sm text-ink-muted">
        {props.editing
          ? 'Your changes weren’t submitted. Your earlier response is still saved.'
          : 'Nothing you entered was submitted.'}
      </p>
      <div class="flex flex-wrap gap-2 pt-1">
        <Button variant="strong" size="sm" onClick={props.onCheckAnswers}>
          Check my answers
        </Button>
        <Show when={props.onMessageOwner}>
          {(message) => (
            <Button variant="ghost" size="sm" onClick={message()}>
              Message the owner
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}

export function ClosedNotice(props: {
  reason: 'closed' | 'deadline' | 'table-gone';
}) {
  return (
    <div class="flex items-center gap-3 rounded-xl border border-edge bg-surface p-5 text-sm text-ink">
      <Lock class="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
      <Switch>
        <Match when={props.reason === 'table-gone'}>
          This form isn’t available right now.
        </Match>
        <Match when={props.reason !== 'table-gone'}>This form is closed.</Match>
      </Switch>
    </div>
  );
}

/** One answer as a receipt reads it. */
export function AnswerValue(props: {
  value: FormCellValue | undefined;
  column: FormColumn;
  widget: QuestionWidget | null;
  renderEntityLabel: (entity: FormEntityReference) => JSX.Element;
}) {
  const optionLabel = (reference: FormOptionReference) =>
    'id' in reference
      ? (props.column.options.find((option) => option.id === reference.id)
          ?.label ?? 'A removed option')
      : reference.label;
  const shown = (): JSX.Element => {
    const value = props.value;
    if (!value) return <span class="text-ink-muted">No answer</span>;
    return match(value)
      .with({ type: 'clear' }, () => (
        <span class="text-ink-muted">No answer</span>
      ))
      .with({ type: 'text' }, (text) => (
        <span class="whitespace-pre-wrap wrap-anywhere">{text.value}</span>
      ))
      .with({ type: 'number' }, (number) => <span>{String(number.value)}</span>)
      .with({ type: 'boolean' }, (checked) => (
        <span>{checked.value ? 'Yes' : 'No'}</span>
      ))
      .with({ type: 'date' }, (date) => (
        <span>{displayDate(date.value, props.widget !== 'date')}</span>
      ))
      .with({ type: 'link' }, (link) => (
        <span class="flex flex-col">
          <For each={link.value}>
            {(url) => (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                class="truncate text-link hover:underline"
              >
                {props.widget === 'file' ? 'Uploaded file' : url}
              </a>
            )}
          </For>
        </span>
      ))
      .with({ type: 'options' }, (options) => (
        <span>{options.value.map(optionLabel).join(', ')}</span>
      ))
      .with({ type: 'entities' }, (entities) => (
        <span class="flex flex-wrap gap-1.5">
          <For each={entities.value}>
            {(entity) => props.renderEntityLabel(entity)}
          </For>
        </span>
      ))
      .with({ type: 'rows' }, (rows) => (
        <span>
          {rows.value.length === 1 ? '1 row' : `${rows.value.length} rows`}
        </span>
      ))
      .exhaustive();
  };
  return <>{shown()}</>;
}

/** After submitting, or on returning: the message, the receipt, and edit. */
export function Confirmation(props: {
  message: string;
  fresh: boolean;
  submittedAt: string | undefined;
  receipt: readonly {
    question: FormQuestion;
    column: FormColumn;
    widget: QuestionWidget | null;
    value: FormCellValue | undefined;
  }[];
  canEdit: boolean;
  compact: boolean;
  renderEntityLabel: (entity: FormEntityReference) => JSX.Element;
  onEdit: () => void;
  /** Why the saved response reads as it does, above the answers. */
  notice?: JSX.Element;
  footer?: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-4">
      <div
        role="status"
        class={cn(
          'flex flex-col items-start gap-2 rounded-xl border border-edge bg-surface',
          props.compact ? 'p-3' : 'p-5'
        )}
      >
        <CheckCircle class="size-7 text-success" aria-hidden="true" />
        <p class="text-base font-medium whitespace-pre-wrap text-ink wrap-anywhere">
          {props.message.trim() || 'Your response is saved.'}
        </p>
        <Show when={!props.fresh && props.submittedAt}>
          {(at) => (
            <p class="text-xs text-ink-muted">
              You responded {displayDate(at(), true)}.
            </p>
          )}
        </Show>
        {props.notice}
        <Show when={props.canEdit}>
          <Button variant="strong" size="sm" onClick={props.onEdit}>
            Edit my response
          </Button>
        </Show>
      </div>
      <Show when={props.receipt.length > 0}>
        <section
          aria-label="Your answers"
          class="overflow-hidden rounded-xl border border-edge bg-surface"
        >
          <h2 class="border-b border-edge-divider px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Your answers
          </h2>
          <dl class="flex flex-col divide-y divide-edge-divider">
            <For each={props.receipt}>
              {(entry) => (
                <div class="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
                  <dt class="text-sm text-ink-muted sm:w-2/5 sm:shrink-0 wrap-anywhere">
                    {entry.column.name}
                  </dt>
                  <dd class="min-w-0 text-sm text-ink">
                    <AnswerValue
                      value={entry.value}
                      column={entry.column}
                      widget={entry.widget}
                      renderEntityLabel={props.renderEntityLabel}
                    />
                  </dd>
                </div>
              )}
            </For>
          </dl>
        </section>
      </Show>
      <Show when={props.footer}>{props.footer}</Show>
    </div>
  );
}

import CaretDown from '@phosphor/caret-down.svg';
import CheckCircle from '@phosphor/check-circle.svg';
import Database from '@phosphor/database.svg';
import Plus from '@phosphor/plus.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import Spinner from '@phosphor/spinner.svg';
import Warning from '@phosphor/warning.svg';
import { Button, cn } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import type { SaveState } from '../../core/form-model';
import type { QuestionTypeId } from '../../core/question-types';
import { QuestionTypeIcon } from '../question-type-icon';
import { DraftInput, DraftTextarea } from './draft-input';

/** Where the drop would land, drawn across the builder column. */
export function DropIndicator(props: { top: number; refusal?: string }) {
  return (
    <div
      aria-hidden="true"
      data-drop-indicator={props.refusal ? 'refused' : 'allowed'}
      class="pointer-events-none absolute inset-x-0 z-10 -translate-y-1/2"
      style={{ top: `${props.top}px` }}
    >
      <div
        class={cn(
          'relative h-0.5 rounded-full',
          props.refusal ? 'bg-failure' : 'bg-accent'
        )}
      >
        <span
          class={cn(
            'absolute -top-1 -left-1 size-2.5 rounded-full border-2 bg-surface',
            props.refusal ? 'border-failure' : 'border-accent'
          )}
        />
      </div>
      <Show when={props.refusal}>
        <p class="mt-1.5 ml-3 inline-block max-w-md rounded-md bg-failure-bg px-2 py-1 text-xs text-failure-ink shadow-menu">
          {props.refusal}
        </p>
      </Show>
    </div>
  );
}

/** "Saving…", "Saved", or "Not saved" beside the tabs. */
export function SaveIndicator(props: { state: SaveState }) {
  return (
    <span
      role="status"
      class="inline-flex items-center gap-1 text-xs text-ink-muted"
    >
      <Switch>
        <Match when={props.state === 'pending' || props.state === 'saving'}>
          <Spinner class="size-3 animate-spin" aria-hidden="true" />
          Saving…
        </Match>
        <Match when={props.state === 'saved'}>
          <CheckCircle class="size-3" aria-hidden="true" />
          Saved
        </Match>
        <Match when={props.state === 'failed'}>
          <Warning class="size-3 text-failure-ink" aria-hidden="true" />
          Not saved
        </Match>
      </Switch>
    </span>
  );
}

/**
 * The form's own card: its name, description and where its answers go. Both
 * fields keep what is being typed while the form is read again underneath.
 */
export function TitleCard(props: {
  name: string;
  description: string;
  meta: JSX.Element;
  /** Each resolves whether it saved; a refused one stays in its field. */
  onName: (name: string) => PromiseLike<boolean>;
  onDescription: (description: string) => PromiseLike<boolean>;
}) {
  return (
    <div class="overflow-hidden rounded-xl border border-edge bg-surface shadow-xs">
      <div class="h-1.5 bg-violet" aria-hidden="true" />
      <div class="flex flex-col gap-1 px-4 pt-4 pb-3">
        <DraftInput
          aria-label="Form name"
          value={props.name}
          maxlength={200}
          class="h-10 w-full rounded-md border border-transparent bg-transparent px-1.5 text-2xl font-semibold text-ink outline-none hover:border-edge-muted focus:border-edge-focus focus:bg-input aria-invalid:border-failure"
          onCommit={props.onName}
        />
        <DraftTextarea
          aria-label="Form description"
          placeholder="Form description"
          value={props.description}
          maxlength={4000}
          rows={2}
          class="w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-ink-muted outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input aria-invalid:border-failure"
          onCommit={props.onDescription}
        />
        {/* Each item's separator sits in its left gutter; the list's negative
            margin clips the gutter of whichever item starts a line. */}
        <div class="overflow-hidden px-1.5 pt-1">
          <ul class="-ml-4 flex flex-wrap items-center gap-y-1 text-xs text-ink-muted [&>li]:relative [&>li]:pl-4 [&>li]:before:absolute [&>li]:before:left-1.5 [&>li]:before:content-['·']">
            {props.meta}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** "3 columns not on this form", expanding to the list with an Add per column. */
export function HiddenColumns(props: {
  columns: readonly {
    id: string;
    name: string;
    type: QuestionTypeId;
    label: string;
  }[];
  onAdd: (columnId: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={props.columns.length > 0}>
      <div class="rounded-xl border border-edge-muted bg-panel">
        <button
          type="button"
          aria-expanded={open()}
          class="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus"
          onClick={() => setOpen(!open())}
        >
          <Database class="size-4" aria-hidden="true" />
          <span class="flex-1">
            {props.columns.length === 1
              ? '1 column not on this form'
              : `${props.columns.length} columns not on this form`}
          </span>
          <CaretDown
            class={cn('size-3.5 transition-transform', open() && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        <Show when={open()}>
          <ul class="flex flex-col divide-y divide-edge-divider border-t border-edge-divider">
            <For each={props.columns}>
              {(column) => (
                <li class="flex items-center gap-3 px-4 py-2">
                  <QuestionTypeIcon
                    type={column.type}
                    class="size-4 text-ink-muted"
                  />
                  <span class="min-w-0 flex-1 truncate text-sm text-ink">
                    {column.name}
                  </span>
                  <span class="text-xs text-ink-muted">{column.label}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => props.onAdd(column.id)}
                  >
                    <Plus class="size-3.5" />
                    Add
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}

/** The right rail: Add, Outline, and where answers are stored. */
export function BuilderRail(props: {
  add: JSX.Element;
  outline: JSX.Element;
  storesTo: JSX.Element;
}) {
  return (
    <aside class="flex w-full flex-col gap-5 text-sm @4xl/builder:sticky @4xl/builder:top-4 @4xl/builder:w-64">
      <div class="flex flex-col gap-2">
        <h3 class="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
          Add
        </h3>
        {props.add}
      </div>
      <div class="hidden flex-col gap-2 @4xl/builder:flex">
        <h3 class="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
          Outline
        </h3>
        {props.outline}
      </div>
      <div class="flex flex-col gap-2">
        <h3 class="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
          Stores to
        </h3>
        {props.storesTo}
      </div>
    </aside>
  );
}

/** One line of the outline: a section or gate with its questions. */
export function OutlineSection(props: {
  name: string;
  gate: boolean;
  questions: readonly { id: string; title: string; selected: boolean }[];
  onSelectQuestion: (questionId: string) => void;
}) {
  return (
    <li class="flex flex-col gap-0.5">
      <span class="flex items-center gap-1.5 truncate text-xs font-medium text-ink">
        <Show when={props.gate}>
          <ShieldCheck class="size-3.5 text-amber-ink" aria-hidden="true" />
        </Show>
        {props.name}
      </span>
      <ul class="flex flex-col border-l border-edge-divider pl-2">
        <For each={props.questions}>
          {(question) => (
            <li>
              <button
                type="button"
                aria-current={question.selected ? 'true' : undefined}
                class={cn(
                  'w-full truncate rounded px-1.5 py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-edge-focus',
                  question.selected
                    ? 'bg-active text-ink'
                    : 'text-ink-muted hover:bg-hover hover:text-ink'
                )}
                onClick={() => props.onSelectQuestion(question.id)}
              >
                {question.title}
              </button>
            </li>
          )}
        </For>
      </ul>
    </li>
  );
}

/** A type change the column refused: what does not fit, and the conversion. */
export function ConversionNotice(props: {
  message: string;
  label: string;
  onConvert: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      class="flex flex-col gap-2 rounded-lg border border-warning bg-warning-bg px-3 py-2.5 text-sm text-warning-ink"
    >
      <p>
        Some answers can’t become {props.label}: {props.message}
      </p>
      <p class="text-xs">
        Convert into a new question: a new {props.label} column gets every
        answer that fits, and the current column keeps all of them.
      </p>
      <div class="flex gap-2">
        <Button size="sm" variant="strong" onClick={props.onConvert}>
          Convert into a new question
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onDismiss}>
          Keep as is
        </Button>
      </div>
    </div>
  );
}

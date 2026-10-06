import CalendarCheck from '@phosphor/calendar-check.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Database from '@phosphor/database.svg';
import Plus from '@phosphor/plus.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, cn } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import type { SectionKind } from '../../core/form-model';
import {
  QUESTION_TYPE_CHOICES,
  QUESTION_TYPE_GROUPS,
  type QuestionTypeChoice,
  type QuestionTypeId,
} from '../../core/question-types';
import { QuestionTypeIcon } from '../question-type-icon';
import { DraftInput, DraftTextarea } from './draft-input';

/** Holds the editor's layout while its shared document opens. */
export function BuilderSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading form editor"
      aria-busy="true"
      class="@container/builder h-full overflow-hidden"
    >
      <div
        aria-hidden="true"
        class="mx-auto grid w-full max-w-[1320px] grid-cols-1 items-start justify-center gap-5 p-4 @3xl/builder:grid-cols-[minmax(0,680px)_272px] @5xl/builder:grid-cols-[272px_minmax(0,680px)_272px] @5xl/builder:py-6"
      >
        <div class="mx-auto flex h-38 w-full max-w-[680px] flex-col gap-4 rounded-xl border border-edge-muted bg-surface p-6 @3xl/builder:col-span-full @3xl/builder:max-w-none">
          <div class="h-7 w-2/5 rounded bg-hover motion-safe:animate-pulse" />
          <div class="h-4 w-3/5 rounded bg-hover motion-safe:animate-pulse" />
          <div class="mt-auto h-3 w-1/4 rounded bg-hover motion-safe:animate-pulse" />
        </div>
        <div class="hidden flex-col gap-5 px-1 py-2 @5xl/builder:flex">
          <div class="h-3 w-16 rounded bg-hover motion-safe:animate-pulse" />
          <For each={[0, 1, 2]}>
            {() => (
              <div class="flex flex-col gap-3">
                <div class="h-4 w-3/5 rounded bg-hover motion-safe:animate-pulse" />
                <div class="ml-3 h-3 w-3/4 rounded bg-hover motion-safe:animate-pulse" />
              </div>
            )}
          </For>
        </div>
        <div class="mx-auto flex w-full max-w-[680px] flex-col gap-4">
          <For each={[0, 1]}>
            {() => (
              <div class="flex h-56 flex-col gap-5 rounded-xl border border-edge-muted bg-surface p-5">
                <div class="h-3 w-1/4 rounded bg-hover motion-safe:animate-pulse" />
                <div class="h-5 w-2/5 rounded bg-hover motion-safe:animate-pulse" />
                <div class="mt-4 h-4 w-1/2 rounded bg-hover motion-safe:animate-pulse" />
                <div class="h-9 w-full rounded bg-hover motion-safe:animate-pulse" />
              </div>
            )}
          </For>
        </div>
        <div class="hidden flex-col gap-3 rounded-xl border border-edge-muted bg-surface p-2 @3xl/builder:flex">
          <div class="h-4 w-24 rounded bg-hover motion-safe:animate-pulse" />
          <div class="grid grid-cols-2 gap-0.5">
            <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
              {() => (
                <div class="h-8 rounded-md bg-hover motion-safe:animate-pulse" />
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}

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

/**
 * The form's own card: its name, description and where its answers go. Both
 * fields keep what is being typed while the form is read again underneath.
 */
export function TitleCard(props: {
  name: string;
  description: string;
  meta: JSX.Element;
  databaseLink: JSX.Element;
  /** Each resolves whether it saved; a refused one stays in its field. */
  onName: (name: string) => PromiseLike<boolean>;
  onDescription: (description: string) => PromiseLike<boolean>;
}) {
  return (
    <section
      aria-label="Form details"
      class="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4 shadow-xs @2xl/builder:flex-row @2xl/builder:items-start"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-1">
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
      <div class="min-w-0 shrink-0 @2xl/builder:max-w-64">
        {props.databaseLink}
      </div>
    </section>
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

/** Section and question navigation to the left of the canvas. */
export function BuilderSidebar(props: { outline: JSX.Element }) {
  return (
    <nav
      aria-label="Form outline"
      class="hidden min-w-0 flex-col gap-2 rounded-xl border border-edge-muted bg-surface p-2.5 text-sm @5xl/builder:sticky @5xl/builder:top-4 @5xl/builder:flex @5xl/builder:max-h-[calc(100dvh-8rem)] @5xl/builder:overflow-y-auto"
    >
      <h3 class="px-1.5 py-1 text-sm font-semibold text-ink">Outline</h3>
      {props.outline}
    </nav>
  );
}

/** Visible type choices are both buttons and drag sources, supplied by the view. */
export function BuilderPalette(props: {
  question: (choice: QuestionTypeChoice) => JSX.Element;
  structure: JSX.Element;
  database: JSX.Element;
}) {
  return (
    <aside
      aria-label="Add to form"
      class="mx-auto flex w-full max-w-[680px] min-w-0 flex-col rounded-xl border border-edge-muted bg-surface @3xl/builder:sticky @3xl/builder:top-4 @3xl/builder:max-h-[calc(100dvh-8rem)] @3xl/builder:overflow-y-auto"
    >
      <div class="border-b border-edge-divider px-3.5 py-2.5">
        <h3 class="text-sm font-semibold text-ink">Add question</h3>
      </div>
      <div class="flex flex-col gap-2 p-2.5">
        <For each={QUESTION_TYPE_GROUPS}>
          {(group) => (
            <div role="group" aria-label={group.label}>
              <h4 class="mb-1 px-1 text-[11px] font-medium text-ink-muted">
                {group.label}
              </h4>
              <div class="grid grid-cols-2 gap-0.5">
                <For
                  each={QUESTION_TYPE_CHOICES.filter(
                    (choice) => choice.group === group.id
                  )}
                >
                  {props.question}
                </For>
              </div>
            </div>
          )}
        </For>
        {props.database}
      </div>
      <div class="border-t border-edge-divider p-2.5">
        <h3 class="mb-1 px-1 text-xs font-semibold text-ink">Form flow</h3>
        {props.structure}
      </div>
    </aside>
  );
}

/** One line of the outline: a section, gate or booking step with its questions. */
export function OutlineSection(props: {
  name: string;
  kind: SectionKind;
  number: number;
  selected: boolean;
  questions: readonly { id: string; title: string; selected: boolean }[];
  onSelectSection: () => void;
  onSelectQuestion: (questionId: string) => void;
}) {
  return (
    <li class="flex flex-col gap-0.5">
      <Button
        variant="ghost"
        size="md"
        fullWidth
        tooltip={props.name}
        aria-current={props.selected ? 'true' : undefined}
        class={cn(
          'justify-start gap-2 rounded-md px-1.5 text-xs text-ink',
          props.selected && 'bg-active'
        )}
        onClick={props.onSelectSection}
      >
        <Switch>
          <Match when={props.kind === 'questions'}>
            <span
              aria-hidden="true"
              class="flex size-5 shrink-0 items-center justify-center rounded border border-edge-muted text-[11px] text-ink-muted"
            >
              {props.number}
            </span>
          </Match>
          <Match when={props.kind === 'gate'}>
            <ShieldCheck class="size-3.5 text-amber-ink" aria-hidden="true" />
          </Match>
          <Match when={props.kind === 'booking'}>
            <CalendarCheck class="size-3.5 text-ink-muted" aria-hidden="true" />
          </Match>
        </Switch>
        <span class="min-w-0 flex-1 truncate text-left">{props.name}</span>
        <Show when={props.questions.length > 0}>
          <span
            aria-hidden="true"
            class="text-[11px] font-normal text-ink-muted"
          >
            {props.questions.length}
          </span>
        </Show>
      </Button>
      <Show when={props.questions.length > 0}>
        <ul class="ml-4 flex flex-col border-l border-edge-divider pl-2">
          <Key each={props.questions} by="id">
            {(question) => (
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  tooltip={question().title}
                  aria-current={question().selected ? 'true' : undefined}
                  class={cn(
                    'h-7 justify-start rounded-md px-1.5 text-left text-xs font-normal',
                    question().selected
                      ? 'bg-active text-ink'
                      : 'text-ink-muted hover:bg-hover hover:text-ink'
                  )}
                  onClick={() => props.onSelectQuestion(question().id)}
                >
                  <span class="truncate">{question().title}</span>
                </Button>
              </li>
            )}
          </Key>
        </ul>
      </Show>
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

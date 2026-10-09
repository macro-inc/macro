import CaretDown from '@phosphor/caret-down.svg';
import Database from '@phosphor/database.svg';
import Plus from '@phosphor/plus.svg';
import { Button, cn } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type { QuestionTypeId } from '../../core/question-types';
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
        class="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-12 px-6"
      >
        <div class="h-8 w-2/5 rounded bg-hover motion-safe:animate-pulse" />
        <div class="h-5 w-1/4 rounded bg-hover motion-safe:animate-pulse" />
        <div class="h-5 w-3/5 rounded bg-hover motion-safe:animate-pulse" />
        <For each={[0, 1]}>
          {() => (
            <div class="h-56 rounded-xl border border-edge-muted bg-surface motion-safe:animate-pulse" />
          )}
        </For>
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
 * The form's document-style heading: its name, description and where its answers go. Both
 * fields keep what is being typed while the form is read again underneath.
 */
export function TitleCard(props: {
  name: string;
  description: string;
  databaseLink: JSX.Element;
  /** Each resolves whether it saved; a refused one stays in its field. */
  onName: (name: string) => PromiseLike<boolean>;
  onDescription: (description: string) => PromiseLike<boolean>;
}) {
  return (
    <section aria-label="Form details" class="flex min-w-0 flex-col">
      <div class="flex min-w-0 flex-col">
        <DraftInput
          aria-label="Form name"
          value={props.name}
          maxlength={200}
          class="h-8 w-full border-0 bg-transparent p-0 text-2xl font-semibold text-ink outline-none aria-invalid:text-failure"
          onCommit={props.onName}
        />
        <div class="mt-3 mb-6 flex flex-wrap items-center gap-2 text-sm">
          {props.databaseLink}
        </div>
        <DraftTextarea
          aria-label="Form description"
          placeholder="Tell people what this form is for…"
          value={props.description}
          maxlength={4000}
          rows={1}
          class="w-full resize-none border-0 bg-transparent p-0 text-base leading-relaxed text-ink outline-none placeholder:text-ink-placeholder field-sizing-content aria-invalid:text-failure"
          onCommit={props.onDescription}
        />
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

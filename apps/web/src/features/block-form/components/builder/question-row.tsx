import Spinner from '@phosphor/spinner.svg';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { DraftInput } from './draft-input';

/**
 * One question in its section's card. Collapsed it previews how it is asked;
 * selected it edits in place: title (the column's name), help text, and the
 * body the type needs, with the actions in a footer.
 */
export function QuestionRow(props: {
  questionId: string;
  number: number;
  title: string;
  helpText: string;
  required: boolean;
  selected: boolean;
  dragging: boolean;
  busy: boolean;
  /** The other editors who selected this question. */
  editors: JSX.Element;
  handle: JSX.Element;
  typeChip: JSX.Element;
  preview: JSX.Element;
  editor: JSX.Element;
  footer: JSX.Element;
  onSelect: () => void;
  onRename: (name: string) => void;
  onHelpText: (helpText: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={`Question ${props.number}: ${props.title}`}
      data-drag-source
      data-form-question={props.questionId}
      data-selected={props.selected ? '' : undefined}
      class={cn(
        'group/question relative flex gap-1 px-2 py-3 transition-[background-color,opacity] duration-100',
        props.selected ? 'bg-panel' : 'hover:bg-hover/50',
        props.dragging && 'opacity-40'
      )}
      onFocusIn={(event) => {
        if (!props.selected && !(event.target instanceof HTMLButtonElement))
          props.onSelect();
      }}
      onClick={(event) => {
        if (props.selected) return;
        if (
          event.target instanceof Element &&
          event.target.closest('button, a, [role="menuitem"]')
        )
          return;
        props.onSelect();
      }}
    >
      <Show when={props.selected}>
        <span
          aria-hidden="true"
          class="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent"
        />
      </Show>
      <div
        class={cn(
          'pt-0.5 transition-opacity',
          props.selected || props.dragging
            ? 'opacity-100'
            : 'opacity-0 group-hover/question:opacity-100 group-focus-within/question:opacity-100 touch:opacity-100'
        )}
      >
        {props.handle}
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <Show
              when={props.selected}
              fallback={
                <p class="pt-1 text-sm font-medium text-ink wrap-anywhere">
                  {props.title}
                  <Show when={props.required}>
                    <span class="ml-0.5 text-failure-ink" aria-label="required">
                      *
                    </span>
                  </Show>
                </p>
              }
            >
              <DraftInput
                aria-label="Question"
                value={props.title}
                maxlength={200}
                class="h-9 w-full rounded-md border border-edge-muted bg-input px-2.5 text-sm font-medium text-ink outline-none focus:border-edge-focus"
                onCommit={props.onRename}
              />
            </Show>
            <Show when={!props.selected && props.helpText}>
              <p class="mt-0.5 text-xs text-ink-muted wrap-anywhere">
                {props.helpText}
              </p>
            </Show>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            {props.editors}
            <Show when={props.busy}>
              <Spinner
                class="size-3.5 animate-spin text-ink-muted"
                aria-label="Saving"
              />
            </Show>
            {props.typeChip}
          </div>
        </div>
        <Show when={props.selected}>
          <input
            aria-label="Help text"
            placeholder="Help text (optional)"
            value={props.helpText}
            maxlength={2000}
            class="h-8 w-full rounded-md border border-transparent bg-transparent px-2.5 text-xs text-ink-muted outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input"
            onInput={(event) => props.onHelpText(event.currentTarget.value)}
          />
        </Show>
        <div class={props.selected ? 'px-0.5' : 'pointer-events-none px-0.5'}>
          {props.selected ? props.editor : props.preview}
        </div>
        <Show when={props.selected}>{props.footer}</Show>
      </div>
    </div>
  );
}

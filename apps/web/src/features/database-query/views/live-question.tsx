import { Popover } from '@kobalte/core/popover';
import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import LightningIcon from '@phosphor/lightning.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { QueryResults } from '../components/query-results';
import {
  formatQueryValue,
  isScalarAnswer,
  type QueryAnswer,
  type QueryDefinition,
  queryErrorMessage,
} from '../core/query';

export function LiveQuestion(props: {
  source: QueryDefinition;
  answer?: QueryAnswer;
  loading: boolean;
  error?: unknown;
  onRefresh: () => void;
  onRename?: (title: string) => void;
  editor?: (onClose: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(!props.source.sql && !!props.editor);
  const [editing, setEditing] = createSignal(!props.source.sql);
  let content: HTMLDivElement | undefined;
  const title = () =>
    props.source.title || props.source.chart?.title || 'Database answer';
  const [renaming, setRenaming] = createSignal(false);
  const [draftTitle, setDraftTitle] = createSignal('');
  const startRename = (event: MouseEvent | KeyboardEvent) => {
    if (!props.onRename || !props.source.sql) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    setDraftTitle(title());
    setRenaming(true);
  };
  const finishRename = () => {
    if (!renaming()) return;
    const next = draftTitle().trim();
    setRenaming(false);
    if (next && next !== title()) props.onRename?.(next);
  };
  const titleInput = () => (
    <input
      ref={(input) =>
        queueMicrotask(() => {
          input.focus();
          input.select();
        })
      }
      aria-label="Answer title"
      class="min-w-0 flex-1 rounded border border-edge bg-input px-1.5 py-0.5 text-sm font-medium text-ink outline-none focus:border-ink/30"
      value={draftTitle()}
      maxLength={100}
      on:input={(event) => setDraftTitle(event.currentTarget.value)}
      onBlur={finishRename}
      onKeyDown={(event) => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          finishRename();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setRenaming(false);
        }
      }}
    />
  );
  const value = () => {
    if (!props.source.sql) return 'Database';
    if (props.error) return 'Answer unavailable';
    if (!props.answer) return 'Loading answer…';
    if (isScalarAnswer(props.answer))
      return formatQueryValue(props.answer.results[0]?.rows[0]?.[0]);
    return `${props.answer.results[0]?.rows.length ?? 0} records`;
  };
  return (
    <Popover
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setEditing(!props.source.sql);
      }}
      placement="bottom-start"
      gutter={8}
      fitViewport
      overlap
      overflowPadding={8}
    >
      <Show
        when={props.source.displayMode !== 'scalar'}
        fallback={
          <Show when={!renaming()} fallback={titleInput()}>
            <Popover.Trigger
              onDblClick={startRename}
              onKeyDown={(event) => {
                if (event.key === 'F2') startRename(event);
              }}
              class="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md border border-edge-muted bg-hover px-1.5 py-0.5 align-baseline text-sm font-medium text-ink hover:bg-hover/70 focus-visible:outline-2 focus-visible:outline-ink/30"
              aria-label={
                props.source.prompt
                  ? `${props.source.prompt}: ${value()}`
                  : value()
              }
              title={
                props.onRename ? `${title()} · Double-click to rename` : title()
              }
            >
              <LightningIcon class="size-3 shrink-0" />
              <Show when={props.source.sql}>
                <span class="truncate text-ink-muted">{title()}</span>
                <span class="text-ink-extra-muted">·</span>
              </Show>
              <span class="truncate tabular-nums">{value()}</span>
            </Popover.Trigger>
          </Show>
        }
      >
        <div
          class="my-3 overflow-hidden rounded-lg border border-edge-muted bg-panel text-ink"
          contentEditable={false}
        >
          <div class="flex items-center justify-between gap-2 border-b border-edge-muted px-3 py-2.5">
            <span class="flex min-w-0 items-center gap-2 text-sm font-medium">
              <LightningIcon class="size-3.5 shrink-0 text-ink-muted" />
              <Show when={!renaming()} fallback={titleInput()}>
                <span
                  class="truncate rounded outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                  tabIndex={props.onRename ? 0 : undefined}
                  title={props.onRename ? 'Double-click to rename' : undefined}
                  onDblClick={startRename}
                  onKeyDown={(event) => {
                    if (event.key === 'F2') startRename(event);
                  }}
                >
                  {title()}
                </span>
              </Show>
            </span>
            <Popover.Trigger class="shrink-0 rounded px-2 py-1 text-xs text-ink-muted">
              {props.editor ? 'Edit question' : 'Details'}
            </Popover.Trigger>
          </div>
          <div class="p-3">
            <Show
              when={!props.error && props.answer}
              fallback={
                <p
                  role={props.error ? 'alert' : 'status'}
                  class="py-3 text-sm text-ink-muted"
                >
                  {value()}
                </p>
              }
            >
              {(answer) => (
                <QueryResults
                  answer={answer()}
                  compact
                  displayMode={props.source.displayMode}
                  chart={props.source.chart}
                />
              )}
            </Show>
          </div>
        </div>
      </Show>
      <Popover.Portal>
        <Popover.Content
          ref={content}
          class="z-action-menu w-[min(440px,calc(100vw-2rem))] max-h-[min(720px,var(--kb-popper-content-available-height,100dvh),calc(100dvh-1rem))] overflow-auto rounded-xl border border-edge-muted bg-panel text-ink shadow-xl"
          contentEditable={false}
          onOpenAutoFocus={(event) => {
            if (!editing()) return;
            const prompt =
              content?.querySelector<HTMLTextAreaElement>('textarea');
            if (prompt) {
              event.preventDefault();
              prompt.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            if (renaming()) event.preventDefault();
          }}
        >
          <div class="sticky top-0 z-1 flex items-center justify-between gap-2 border-b border-edge-muted bg-panel px-4 py-3">
            <Popover.Title class="flex items-center gap-2 text-sm font-medium">
              <LightningIcon class="size-4 text-ink-muted" />
              {title()}
            </Popover.Title>
            <Popover.CloseButton
              class="rounded p-1 text-ink-muted hover:bg-hover"
              aria-label="Close database answer"
            >
              <XIcon class="size-4" />
            </Popover.CloseButton>
          </div>
          <Show
            when={editing() && props.editor}
            fallback={
              <div class="space-y-3 p-4">
                <p class="text-sm font-medium">
                  {props.source.prompt || 'Database question'}
                </p>
                <Show when={props.error}>
                  <p role="alert" class="text-sm text-failure-ink">
                    {queryErrorMessage(props.error)}
                  </p>
                </Show>
                <Show when={!props.error && props.answer}>
                  {(answer) => (
                    <QueryResults
                      answer={answer()}
                      displayMode={props.source.displayMode}
                      chart={props.source.chart}
                    />
                  )}
                </Show>
                <Show when={!props.answer && props.loading}>
                  <p role="status" class="text-sm text-ink-muted">
                    Finding your answer…
                  </p>
                </Show>
                <details class="text-xs">
                  <summary class="text-ink-muted">View SQL</summary>
                  <pre class="mt-2 overflow-auto whitespace-pre-wrap rounded-md bg-input p-2">
                    {props.source.sql}
                  </pre>
                </details>
                <div class="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={props.onRefresh}
                    disabled={props.loading}
                  >
                    <ArrowClockwiseIcon class="size-3.5" />
                    Refresh
                  </Button>
                  <Show when={props.editor}>
                    <Button size="sm" onClick={() => setEditing(true)}>
                      <PencilIcon class="size-3.5" />
                      Edit question
                    </Button>
                  </Show>
                </div>
              </div>
            }
          >
            {props.editor?.(() => setOpen(false))}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

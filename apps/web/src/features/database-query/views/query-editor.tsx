import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CodeIcon from '@phosphor/code.svg';
import PlayIcon from '@phosphor/play.svg';
import TableIcon from '@phosphor/table.svg';
import { Button } from '@ui/components/Button';
import {
  type Accessor,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onMount,
  Show,
} from 'solid-js';
import { QueryResults } from '../components/query-results';
import { QuestionExamples } from '../components/question-examples';
import { SqlEditor } from '../components/sql-editor';
import type { QueryCapabilities } from '../context/query-context';
import {
  isScalarAnswer,
  type QueryAnswer,
  type QueryDefinition,
  type QuerySchema,
  queryFocusTable,
} from '../core/query';
import {
  isChartMode,
  prepareQueryChart,
  type QueryDisplayMode,
} from '../core/query-chart';
import { questionExamples } from '../core/question-examples';
import { createQueryComposer } from '../primitives/query-composer';

export function QueryEditor(props: {
  schema: QuerySchema;
  initial: QueryDefinition;
  capabilities: QueryCapabilities;
  sourceAvailable?: boolean;
  sourcePicker?: JSX.Element | ((schema: Accessor<QuerySchema>) => JSX.Element);
  onSave?: (definition: QueryDefinition, answer: QueryAnswer) => void;
  saveLabel?: string;
  saveHint?: string;
  autoFocus?: boolean;
  promptPlaceholder?: string;
}) {
  const composer = createQueryComposer({
    ...props.capabilities,
    initial: props.initial,
    schema: () => props.schema,
  });
  // Build the picker once; reactive schema reads belong inside its props.
  // Recreating it on source changes removes the trigger before focus restores.
  const sourcePicker =
    typeof props.sourcePicker === 'function'
      ? props.sourcePicker(composer.schema)
      : props.sourcePicker;
  const promptId = createUniqueId();
  let promptInput: HTMLTextAreaElement | undefined;
  const [sqlOpen, setSqlOpen] = createSignal(false);
  const displayMode = (): QueryDisplayMode =>
    composer.presentation().displayMode === 'scalar' &&
    composer.preview() &&
    !isScalarAnswer(composer.preview()!.answer)
      ? 'table'
      : composer.presentation().displayMode;
  const displayOptions = () => {
    const current = composer.preview()?.answer;
    if (!current) return [];
    return [
      ...(isScalarAnswer(current)
        ? [{ value: 'scalar' as const, label: 'Inline answer' }]
        : []),
      { value: 'table' as const, label: 'Result table' },
      ...(['bar', 'line', 'pie'] as const)
        .filter(
          (mode) =>
            mode === displayMode() ||
            !!prepareQueryChart(current, mode, composer.presentation().chart)
              .data ||
            !!prepareQueryChart(current, mode).data
        )
        .map((value) => ({
          value,
          label: `${value[0].toUpperCase()}${value.slice(1)} chart`,
        })),
    ];
  };
  const savedChart = () => {
    const current = composer.preview()?.answer;
    const mode = displayMode();
    return current && isChartMode(mode)
      ? prepareQueryChart(current, mode, composer.presentation().chart).data
          ?.config
      : undefined;
  };
  const answer = () =>
    composer.isCurrentPreview() ? composer.preview()?.answer : undefined;
  const busy = () => composer.phase() !== 'idle';
  const requestReadOnly = () =>
    !!props.capabilities.generationCanWrite && composer.generationPending();
  const focusTable = () => queryFocusTable(composer.schema());
  const sourceAvailable = () => props.sourceAvailable !== false;
  const needsGeneration = () =>
    !composer.sql().trim() || composer.needsGeneration();
  const canAsk = () =>
    !busy() &&
    !composer.actionNeedsRevision() &&
    !composer.outcomeUnknown() &&
    sourceAvailable() &&
    !!(needsGeneration() ? composer.prompt().trim() : composer.sql().trim());
  const ask = () => {
    if (!canAsk()) return;
    void (needsGeneration() ? composer.generate() : composer.run());
  };
  onMount(() => {
    if (props.autoFocus) promptInput?.focus();
    if (props.initial.sql.trim() && !composer.needsGeneration())
      void composer.run();
  });

  return (
    <div class="flex min-h-0 flex-col gap-3 p-4" data-database-query-editor>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <label class="sr-only" for={promptId}>
          What would you like to know?
        </label>
        <div class="rounded-lg border border-edge bg-input p-3 transition-colors focus-within:border-ink/30 focus-within:ring-2 focus-within:ring-ink/10">
          <div class="relative">
            <textarea
              ref={promptInput}
              id={promptId}
              aria-label="Ask your database"
              class="min-h-16 w-full resize-none bg-transparent text-sm text-ink outline-none"
              classList={{
                'placeholder:text-transparent': !props.promptPlaceholder,
                'placeholder:text-ink-placeholder': !!props.promptPlaceholder,
              }}
              placeholder={
                props.promptPlaceholder ?? 'Ask anything about your data…'
              }
              value={composer.prompt()}
              readOnly={requestReadOnly()}
              onInput={(event) => composer.setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  ask();
                }
              }}
            />
            <Show when={!composer.prompt() && !props.promptPlaceholder}>
              <QuestionExamples
                examples={questionExamples(composer.schema())}
              />
            </Show>
          </div>
          <div class="flex items-center justify-end gap-2">
            <Button type="submit" size="sm" disabled={!canAsk()}>
              <Show
                when={busy()}
                fallback={
                  <>
                    {composer.preview() && composer.needsGeneration()
                      ? 'Update answer'
                      : 'Ask'}{' '}
                    <ArrowUpIcon class="size-3.5" />
                  </>
                }
              >
                {composer.phase() === 'generating'
                  ? 'Thinking…'
                  : 'Finding answer…'}
              </Show>
            </Button>
          </div>
        </div>
      </form>
      <div class="flex min-w-0 items-center justify-between gap-3 text-xs">
        <div class="min-w-0 flex-1">
          <Show
            when={sourcePicker}
            fallback={
              <div class="flex min-w-0 items-center gap-1.5 text-ink-muted">
                <TableIcon class="size-3.5 shrink-0" />
                <span
                  class="truncate"
                  title={focusTable()?.name ?? composer.schema().name}
                >
                  {focusTable()?.name ?? composer.schema().name}
                </span>
                <Show when={focusTable()}>
                  <span class="truncate" title={composer.schema().name}>
                    · {composer.schema().name}
                  </span>
                </Show>
              </div>
            }
          >
            {sourcePicker}
          </Show>
        </div>
        <button
          type="button"
          class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50"
          aria-expanded={sqlOpen()}
          onClick={() => setSqlOpen(!sqlOpen())}
        >
          <CodeIcon class="size-3.5" /> {sqlOpen() ? 'Hide SQL' : 'SQL'}
        </button>
      </div>
      <Show when={!sourceAvailable()}>
        <p class="text-xs text-ink-muted">
          Choose an available database to update this answer.
        </p>
      </Show>
      <Show when={sqlOpen()}>
        <div>
          <SqlEditor
            value={composer.sql()}
            schema={composer.schema()}
            readOnly={requestReadOnly()}
            onChange={composer.setSql}
            onRun={() => void composer.run()}
          />
          <div class="mt-1.5 flex items-center justify-between gap-2">
            <p class="text-[11px] text-ink-muted">
              Read-only SQLite · ⌘ / Ctrl + Enter to run
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy() || !composer.sql().trim()}
              onClick={() => void composer.run()}
            >
              <PlayIcon class="size-3.5" /> Run SQL
            </Button>
          </div>
        </div>
      </Show>
      <Show when={composer.canUndo()}>
        <button
          class="self-start text-xs text-ink-muted underline decoration-edge underline-offset-2 hover:text-ink"
          onClick={composer.undoChanges}
        >
          Undo
        </button>
      </Show>
      <Show when={composer.error()}>
        {(message) => (
          <div
            role="alert"
            class="rounded-md border border-failure-ink/20 bg-failure-ink/5 px-3 py-2 text-sm text-failure-ink"
          >
            <p>{message()}</p>
            <Show
              when={
                composer.errorDetail() && composer.errorDetail() !== message()
              }
            >
              <details class="mt-2 text-xs">
                <summary>Technical details</summary>
                <pre class="mt-1 whitespace-pre-wrap break-words">
                  {composer.errorDetail()}
                </pre>
              </details>
            </Show>
          </div>
        )}
      </Show>
      <Show when={composer.phase() === 'running'}>
        <p role="status" class="text-xs text-ink-muted">
          Finding your answer…
        </p>
      </Show>
      <Show when={composer.actionSummary()}>
        <p
          role="status"
          class="rounded-md border border-edge-muted bg-hover/40 px-3 py-2 text-sm text-ink"
        >
          {composer.actionSummary()}
        </p>
      </Show>
      <Show when={composer.actionNeedsRevision()}>
        <p class="text-xs leading-5 text-ink-muted">
          These changes are saved. Edit your request before continuing.
        </p>
      </Show>
      <Show when={composer.outcomeUnknown()}>
        <p class="text-xs leading-5 text-ink-muted">
          Check the table, then edit your request to continue.
        </p>
      </Show>
      <Show when={composer.preview()}>
        {(preview) => (
          <div class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
              <Show
                when={displayOptions().length > 1}
                fallback={<span class="font-medium text-ink">Answer</span>}
              >
                <select
                  aria-label="Display answer as"
                  value={displayMode()}
                  disabled={busy()}
                  onChange={(event) =>
                    composer.setDisplayMode(
                      event.currentTarget.value as QueryDisplayMode
                    )
                  }
                  class="h-7 min-w-0 rounded-md border border-transparent bg-transparent px-1 text-xs font-medium text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/25"
                >
                  <For each={displayOptions()}>
                    {(option) => (
                      <option
                        value={option.value}
                        selected={displayMode() === option.value}
                      >
                        {option.label}
                      </option>
                    )}
                  </For>
                </select>
              </Show>
              <div class="flex items-center gap-2 text-ink-muted">
                <Show when={!composer.isCurrentPreview()}>
                  <span>
                    {busy()
                      ? 'Updating…'
                      : composer.sourceChanged()
                        ? 'Source changed · update answer'
                        : composer.needsGeneration()
                          ? 'Question changed · update answer'
                          : preview().sql !== composer.sql().trim()
                            ? 'SQL changed · run SQL'
                            : 'Previous answer'}
                  </span>
                </Show>
                <Show when={!needsGeneration()}>
                  <button
                    type="button"
                    aria-label="Refresh answer"
                    title="Refresh answer"
                    disabled={busy() || !sourceAvailable()}
                    class="rounded p-1 text-ink-muted hover:bg-hover hover:text-ink disabled:opacity-40"
                    onClick={() => void composer.run()}
                  >
                    <ArrowClockwiseIcon class="size-3.5" />
                  </button>
                </Show>
              </div>
            </div>
            <div classList={{ 'opacity-50': !composer.isCurrentPreview() }}>
              <QueryResults
                answer={preview().answer}
                displayMode={displayMode()}
                chart={composer.presentation().chart}
              />
              <Show when={preview().explanation}>
                <details class="mt-3 text-xs leading-5 text-ink-muted">
                  <summary>How this was calculated</summary>
                  <p class="mt-1.5">{preview().explanation}</p>
                </details>
              </Show>
            </div>
            <Show when={answer() && props.onSave}>
              <div class="flex flex-wrap items-center justify-between gap-2 border-t border-edge-muted pt-3">
                <Button
                  size="sm"
                  class="ml-auto"
                  onClick={() =>
                    props.onSave?.(
                      {
                        databaseId: composer.answerDatabaseId(),
                        ...(composer.tableId()
                          ? { tableId: composer.tableId() }
                          : {}),
                        sql: composer.sql().trim(),
                        prompt: composer.prompt().trim(),
                        title: composer.presentation().title,
                        displayMode:
                          isChartMode(displayMode()) && !savedChart()
                            ? 'table'
                            : displayMode(),
                        ...(savedChart() ? { chart: savedChart() } : {}),
                      },
                      preview().answer
                    )
                  }
                >
                  {props.saveLabel ?? 'Insert answer'}
                </Button>
                <Show when={props.saveHint}>
                  <p class="w-full text-[11px] leading-5 text-ink-muted">
                    {props.saveHint}
                  </p>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

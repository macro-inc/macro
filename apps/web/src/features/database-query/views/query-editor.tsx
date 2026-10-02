import { isFeatureEnabled, showDatabaseSql } from '@core/constant/featureFlags';
import {
  DATABASE_QUERY_CHART_MODES,
  type DatabaseQueryDisplayMode,
  isDatabaseQueryChartMode,
  isDatabaseQueryDisplayMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { Telemetry } from '@macro-inc/observability';
import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CodeIcon from '@phosphor/code.svg';
import PlayIcon from '@phosphor/play.svg';
import TableIcon from '@phosphor/table.svg';
import { Button } from '@ui/components/Button';
import { Hotkey } from '@ui/components/Hotkey';
import {
  type Accessor,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onMount,
  Show,
} from 'solid-js';
import { match, P } from 'ts-pattern';
import { QueryResults } from '../components/query-results';
import { QuestionExamples } from '../components/question-examples';
import { SqlEditor } from '../components/sql-editor';
import { useAnswerDisplay } from '../context/answer-display';
import type { QueryCapabilities } from '../context/query-context';
import { unknownNames } from '../core/answer-cell';
import {
  isScalarAnswer,
  type QueryDefinition,
  type QuerySchema,
  queryFocusTable,
} from '../core/query';
import {
  availableDisplayModes,
  chartModeLabel,
  prepareQueryChart,
} from '../core/query-chart';
import { questionExamples } from '../core/question-examples';
import { createQueryComposer } from '../primitives/query-composer';

export function QueryEditor(props: {
  schema: QuerySchema;
  initial: QueryDefinition;
  capabilities: QueryCapabilities;
  sourceAvailable?: boolean;
  sourcePicker?: JSX.Element | ((schema: Accessor<QuerySchema>) => JSX.Element);
  onSave?: (definition: QueryDefinition) => void;
  saveLabel?: string;
  autoFocus?: boolean;
  /** Editing a saved document answer commits a successful regeneration directly. */
  saveOnGenerate?: boolean;
  saving?: boolean;
}) {
  const showSql = isFeatureEnabled(showDatabaseSql);
  const display = useAnswerDisplay();
  const composer = createQueryComposer({
    ...props.capabilities,
    initial: props.initial,
    schema: () => props.schema,
    showSql,
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
  const displayMode = (): DatabaseQueryDisplayMode => {
    const preview = composer.preview();
    return composer.presentation().displayMode === 'scalar' &&
      preview &&
      !isScalarAnswer(preview.answer)
      ? 'table'
      : composer.presentation().displayMode;
  };
  const displayOptions = () => {
    const current = composer.preview()?.answer;
    if (!current) return [];
    return availableDisplayModes(current, {
      displayMode: displayMode(),
      chart: composer.presentation().chart,
    }).map((value) => ({
      value,
      label: match(value)
        .with('scalar', () => 'Inline answer')
        .with('table', () => 'Result table')
        .with(P.union(...DATABASE_QUERY_CHART_MODES), chartModeLabel)
        .exhaustive(),
    }));
  };
  const savedChart = () => {
    const current = composer.preview()?.answer;
    const mode = displayMode();
    return current && isDatabaseQueryChartMode(mode)
      ? prepareQueryChart(
          current,
          mode,
          composer.presentation().chart,
          unknownNames
        ).data?.config
      : undefined;
  };
  const answer = () =>
    composer.isCurrentPreview() ? composer.preview()?.answer : undefined;
  const names = display.names(() => composer.preview()?.answer);
  const busy = () => composer.phase() !== 'idle' || props.saving === true;
  const focusTable = () => queryFocusTable(composer.schema());
  const sourceAvailable = () => props.sourceAvailable !== false;
  const needsGeneration = () =>
    props.saveOnGenerate ||
    !composer.sql().trim() ||
    composer.needsGeneration();
  const canAsk = () =>
    !busy() &&
    sourceAvailable() &&
    !!(needsGeneration() ? composer.prompt().trim() : composer.sql().trim());
  const ask = async () => {
    if (!canAsk()) return;
    const span = Telemetry.span('database.query.regenerate');
    try {
      await span.run(() =>
        needsGeneration() ? composer.generate() : composer.run()
      );
      span.setAttr('database.outcome', composer.error() ? 'error' : 'success');
    } finally {
      span.end();
    }
    if (
      props.saveOnGenerate &&
      !composer.error() &&
      composer.isCurrentPreview()
    )
      accept();
  };
  // A current answer is accepted with Enter; changing the prompt asks again.
  const canAccept = () => !!answer() && !!props.onSave && !props.saveOnGenerate;
  const accept = () => {
    if (!answer() || !props.onSave) return;
    props.onSave({
      databaseId: composer.answerDatabaseId(),
      ...(composer.tableId() ? { tableId: composer.tableId() } : {}),
      sql: composer.sql().trim(),
      prompt: composer.prompt().trim(),
      title: composer.presentation().title,
      displayMode:
        isDatabaseQueryChartMode(displayMode()) && !savedChart()
          ? 'table'
          : displayMode(),
      ...(savedChart() ? { chart: savedChart() } : {}),
    });
  };
  const editPrompt = () => {
    if (!promptInput) return;
    promptInput.focus();
    const end = promptInput.value.length;
    promptInput.setSelectionRange(end, end);
  };
  const isPlainEnter = (event: KeyboardEvent) =>
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229;
  // Controls with their own Enter (buttons, menus, the SQL editor) keep it.
  const ownsEnter = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest(
      'button, a, select, input, textarea, [contenteditable="true"]'
    );
  onMount(() => {
    if (props.autoFocus) promptInput?.focus();
    if (
      !props.saveOnGenerate &&
      props.initial.sql.trim() &&
      !composer.needsGeneration()
    )
      void composer.run();
  });

  return (
    <div
      class="flex min-h-0 flex-col gap-3 p-4"
      data-database-query-editor
      onKeyDown={(event) => {
        if (!isPlainEnter(event) || !canAccept() || ownsEnter(event.target))
          return;
        event.preventDefault();
        accept();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
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
              class="min-h-16 w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-transparent"
              placeholder="Ask anything about your data…"
              value={composer.prompt()}
              onInput={(event) => composer.setPrompt(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.isComposing || event.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (canAccept()) accept();
                  else void ask();
                }
              }}
            />
            <Show when={!composer.prompt()}>
              <QuestionExamples
                examples={questionExamples(composer.schema())}
              />
            </Show>
          </div>
          <Show when={!canAccept()}>
            <div class="flex items-center justify-end gap-2">
              <Button type="submit" size="sm" disabled={!canAsk()}>
                <Show
                  when={busy()}
                  fallback={
                    <>
                      {props.saveOnGenerate
                        ? 'Regenerate'
                        : composer.preview() && composer.needsGeneration()
                          ? 'Update answer'
                          : 'Ask'}{' '}
                      <ArrowUpIcon class="size-3.5" />
                    </>
                  }
                >
                  {props.saving
                    ? 'Saving…'
                    : composer.phase() === 'generating'
                      ? 'Thinking…'
                      : 'Finding answer…'}
                </Show>
              </Button>
            </div>
          </Show>
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
        <Show when={showSql}>
          <button
            type="button"
            class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50"
            aria-expanded={sqlOpen()}
            onClick={() => setSqlOpen(!sqlOpen())}
          >
            <CodeIcon class="size-3.5" /> {sqlOpen() ? 'Hide SQL' : 'SQL'}
          </button>
        </Show>
      </div>
      <Show when={!sourceAvailable()}>
        <p class="text-xs text-ink-muted">
          Choose an available database to update this answer.
        </p>
      </Show>
      <Show when={showSql && sqlOpen()}>
        <div>
          <SqlEditor
            value={composer.sql()}
            schema={composer.schema()}
            onChange={composer.setSql}
            onRun={() => void composer.run()}
          />
          <div class="mt-1.5 flex items-center justify-between gap-2">
            <p class="text-[11px] text-ink-muted">
              Read-only SQL · ⌘ / Ctrl + Enter to run
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
                showSql &&
                composer.errorDetail() &&
                composer.errorDetail() !== message()
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
                  onChange={(event) => {
                    const mode = event.currentTarget.value;
                    if (isDatabaseQueryDisplayMode(mode))
                      composer.setDisplayMode(mode);
                  }}
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
                names={names()}
                display={display}
              />
            </div>
            <Show when={canAccept()}>
              <div class="flex flex-wrap items-center justify-end gap-2 border-t border-edge-muted pt-3">
                <Button variant="ghost" size="sm" onClick={editPrompt}>
                  Edit
                </Button>
                <Button size="sm" onClick={accept}>
                  {props.saveLabel ?? 'Insert'}
                  <Hotkey shortcut="enter" theme="current" aria-hidden="true" />
                </Button>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

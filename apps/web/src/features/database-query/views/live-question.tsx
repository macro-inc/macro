import { ScopedPortal } from '@core/component/ScopedPortal';
import { isFeatureEnabled, showDatabaseSql } from '@core/constant/featureFlags';
import { Popover } from '@kobalte/core/popover';
import LightningIcon from '@phosphor/lightning.svg';
import XIcon from '@phosphor/x.svg';
import { createSignal, type JSX, Show } from 'solid-js';
import { AnswerTitleField } from '../components/answer-title-field';
import { QueryResults, ScalarValue } from '../components/query-results';
import { QuestionDetails } from '../components/question-details';
import { ResizableAnswer } from '../components/resizable-answer';
import { useAnswerDisplay } from '../context/answer-display';
import { resultCell, resultCellText } from '../core/answer-cell';
import {
  isScalarAnswer,
  type QueryAnswer,
  type QueryFailure,
  queryErrorMessage,
  type SavedQuestion,
} from '../core/query';

export function LiveQuestion(props: {
  source: SavedQuestion;
  answer?: QueryAnswer;
  loading: boolean;
  error?: QueryFailure;
  onRefresh: () => void;
  onRename?: (title: string) => void;
  onResize?: (height: number) => void;
  /** The saved SQL, rendered only once the details are opened. */
  sql?: () => JSX.Element;
  /** Reuses the question composer for drafts and edits to saved answers. */
  editor?: (onClose: () => void) => JSX.Element;
  /** Leaving the editor of an answer that was never saved drops the answer. */
  onDiscard?: () => void;
}) {
  const [open, setOpen] = createSignal(!props.source.queryId && !!props.editor);
  let content: HTMLDivElement | undefined;
  const title = () =>
    props.source.title || props.source.chart?.title || 'Database answer';
  const [renaming, setRenaming] = createSignal(false);
  const [draftTitle, setDraftTitle] = createSignal('');
  const startRename = (event: MouseEvent | KeyboardEvent) => {
    if (!props.onRename || !props.source.queryId) return;
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
  const display = useAnswerDisplay();
  const names = display.names(() => props.answer);
  const showSql = isFeatureEnabled(showDatabaseSql);
  const block = () => props.source.displayMode !== 'scalar';
  const scalarAnswer = () =>
    props.source.queryId &&
    !props.error &&
    props.answer &&
    isScalarAnswer(props.answer)
      ? props.answer
      : undefined;
  const value = () => {
    if (!props.source.queryId) return 'Database';
    if (props.error) return 'Answer unavailable';
    if (!props.answer) return 'Loading answer…';
    if (isScalarAnswer(props.answer))
      return resultCellText(
        resultCell(props.answer.rows[0][0] ?? null, props.answer.columns[0]),
        names()
      );
    const count = props.answer.rows.length;
    return `${count} ${count === 1 ? 'record' : 'records'}`;
  };
  return (
    <Popover
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value && !props.source.queryId) props.onDiscard?.();
      }}
      placement="bottom-start"
      gutter={8}
      fitViewport
      overlap
      overflowPadding={8}
    >
      <Show
        when={block()}
        fallback={
          <Show
            when={!renaming()}
            fallback={
              <AnswerTitleField
                placement="inline"
                value={draftTitle()}
                onInput={setDraftTitle}
                onCommit={finishRename}
                onCancel={() => setRenaming(false)}
              />
            }
          >
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
              <Show when={props.source.queryId}>
                <span class="truncate text-ink-muted">{title()}</span>
                <span class="text-ink-extra-muted">·</span>
              </Show>
              <span class="truncate tabular-nums">
                <Show when={scalarAnswer()} fallback={value()}>
                  {(answer) => (
                    <ScalarValue
                      answer={answer()}
                      names={names()}
                      display={display}
                    />
                  )}
                </Show>
              </span>
            </Popover.Trigger>
          </Show>
        }
      >
        <div
          class="overflow-hidden rounded-lg border border-edge-muted bg-panel text-ink"
          contentEditable={false}
        >
          <div class="flex items-center justify-between gap-2 border-b border-edge-muted px-3 py-2.5">
            <span class="flex min-w-0 items-center gap-2 text-sm font-medium">
              <LightningIcon class="size-3.5 shrink-0 text-ink-muted" />
              <Show
                when={!renaming()}
                fallback={
                  <AnswerTitleField
                    placement="header"
                    value={draftTitle()}
                    onInput={setDraftTitle}
                    onCommit={finishRename}
                    onCancel={() => setRenaming(false)}
                  />
                }
              >
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
              Details
            </Popover.Trigger>
          </div>
          <ResizableAnswer
            height={props.source.height}
            onResize={props.onResize}
          >
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
                  names={names()}
                  display={display}
                  compact
                  unbounded
                  displayMode={props.source.displayMode}
                  chart={props.source.chart}
                />
              )}
            </Show>
          </ResizableAnswer>
        </div>
      </Show>
      <ScopedPortal scope="local">
        <Popover.Content
          ref={content}
          class="z-action-menu w-[min(440px,calc(100vw-2rem))] max-h-[min(720px,var(--kb-popper-content-available-height,100dvh),calc(100dvh-1rem))] overflow-auto rounded-xl border border-edge-muted bg-panel text-ink shadow-xl"
          contentEditable={false}
          onOpenAutoFocus={(event) => {
            if (!props.editor) return;
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
            when={props.editor}
            fallback={
              <QuestionDetails
                prompt={props.source.prompt}
                error={
                  props.error
                    ? queryErrorMessage(props.error, showSql)
                    : undefined
                }
                results={
                  // A block already shows its answer; only an inline chip needs it here.
                  <Show when={!block() && !props.error && props.answer}>
                    {(answer) => (
                      <QueryResults
                        answer={answer()}
                        names={names()}
                        display={display}
                        displayMode={props.source.displayMode}
                        chart={props.source.chart}
                      />
                    )}
                  </Show>
                }
                loading={!props.answer && props.loading}
                sql={showSql ? props.sql : undefined}
                onRefresh={props.onRefresh}
              />
            }
          >
            {props.editor?.(() => setOpen(false))}
          </Show>
        </Popover.Content>
      </ScopedPortal>
    </Popover>
  );
}

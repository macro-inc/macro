import { formatLocale, t } from '@app/lib/i18n';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import TableIcon from '@icon/system/regular/table.svg';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { PropertyIcon } from '../../database/components/property-icon';
import type { PipelineEntry, PipelineEntryCell } from '../core/pipeline-entry';
import {
  isEmptyCell,
  isLongText,
  type PipelineCellFit,
  type PipelineEntryFold,
  pipelineCellFit,
  pipelineEntryFields,
} from '../core/pipeline-entry-fields';

/** How a card shows one value. Its fields are read reactively. */
export type PipelineCellDisplay = {
  readonly fit: PipelineCellFit;
  /** What an unset field says; a checkbox is never unset, so it has none. */
  readonly emptyLabel: string | undefined;
};

/** One card per pipeline row that references the record. */
export function PipelineEntryCards(props: {
  entries: PipelineEntry[];
  /** One field's value: a `GridCell` in its `property` layout. */
  renderCell: (
    entry: Accessor<PipelineEntry>,
    cell: Accessor<PipelineEntryCell>,
    display: PipelineCellDisplay
  ) => JSX.Element;
  onOpenPipeline?: (pipelineId: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <Show when={props.entries.length > 0}>
      <section class="flex flex-col gap-2.5" aria-label={t('crm.pipelines')}>
        <h2 class="flex">
          <button
            type="button"
            class="flex items-center gap-1"
            aria-expanded={expanded()}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded() ? (
              <CaretDownIcon class="size-3" />
            ) : (
              <CaretRightIcon class="size-3" />
            )}
            <span class="text-xs">{t('crm.pipelines')}</span>
          </button>
        </h2>
        <Show when={expanded()}>
          <div class="flex flex-col gap-3">
            <Key each={props.entries} by="rowId">
              {(entry) => (
                <PipelineEntryCard
                  entry={entry()}
                  renderCell={(cell, display) =>
                    props.renderCell(entry, cell, display)
                  }
                  onOpenPipeline={
                    props.onOpenPipeline
                      ? () => props.onOpenPipeline?.(entry().pipeline.id)
                      : undefined
                  }
                />
              )}
            </Key>
          </div>
        </Show>
      </section>
    </Show>
  );
}

function PipelineEntryCard(props: {
  entry: PipelineEntry;
  renderCell: (
    cell: Accessor<PipelineEntryCell>,
    display: PipelineCellDisplay
  ) => JSX.Element;
  onOpenPipeline?: () => void;
}) {
  let card: HTMLElement | undefined;
  let list: HTMLDivElement | undefined;
  // Which fields are empty is read when the card opens or folds, so a value
  // cleared in place keeps its row instead of jumping into the fold. A value
  // that arrives later always leaves the fold.
  const readEmpty = () =>
    Object.fromEntries(
      props.entry.cells.map((cell) => [cell.column.id, isEmptyCell(cell)])
    );
  const [view, setView] = createStore<{
    fold: PipelineEntryFold;
    settledEmpty: Record<string, boolean>;
  }>({ fold: 'collapsed', settledEmpty: readEmpty() });
  const fold = () => view.fold;
  const isEmpty = (cell: PipelineEntryCell) =>
    (view.settledEmpty[cell.column.id] ?? true) && isEmptyCell(cell);
  const setFold = (next: PipelineEntryFold) =>
    setView({ fold: next, settledEmpty: readEmpty() });
  // Every row reads it for its fit, so it is worked out once per change.
  const fields = createMemo(() =>
    pipelineEntryFields(props.entry.cells, isEmpty, fold())
  );
  const listFormat = createMemo(
    () => new Intl.ListFormat(formatLocale(), { style: 'short', type: 'unit' })
  );
  const foldedNames = createMemo(() =>
    listFormat().format(fields().folded.map((cell) => cell.column.name))
  );
  const toggle = () => {
    const collapsing = fold() !== 'collapsed';
    setFold(collapsing ? 'collapsed' : 'filled');
    // Collapsing from the pinned control can leave the now shorter card above the view.
    if (collapsing) card?.scrollIntoView({ block: 'nearest' });
  };
  const openFolded = (event: MouseEvent & { currentTarget: HTMLElement }) => {
    const first = fields().folded[0]?.column.id;
    const focused = document.activeElement === event.currentTarget;
    setFold('all');
    // The row goes as it opens; its focus moves to the first field it held.
    if (!focused || !first) return;
    const row = [
      ...(list?.querySelectorAll<HTMLElement>('[data-field]') ?? []),
    ].find((field) => field.dataset.field === first);
    row?.querySelector<HTMLElement>('[data-cell-display]')?.focus();
  };
  return (
    <article
      ref={card}
      class="flex min-w-0 flex-col rounded-xl border border-edge-muted bg-panel"
      aria-label={props.entry.pipeline.name}
    >
      <header class="flex h-10 items-center gap-2.5 rounded-t-xl border-b border-edge-muted bg-hover pl-3.5 pr-1.5">
        <TableIcon class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 truncate text-[13px] font-medium">
          {props.entry.pipeline.name}
        </span>
        <Show when={!props.entry.pipeline.shared}>
          <LockIcon
            aria-hidden={false}
            role="img"
            aria-label={t('crm.pipelineEntryPrivate')}
            class="size-3 shrink-0 text-ink-placeholder"
          />
        </Show>
        <span class="flex-1" />
        <Show when={props.onOpenPipeline}>
          {(open) => (
            <Button
              variant="ghost"
              aria-label={t('crm.pipelineEntryOpen', {
                name: props.entry.pipeline.name,
              })}
              tooltip={t('crm.pipelineEntryOpen', {
                name: props.entry.pipeline.name,
              })}
              size="icon-sm"
              onClick={() => open()()}
            >
              <ArrowUpRightIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
          )}
        </Show>
      </header>
      {/* Each value is a property-layout cell from renderCell: 32px rows,
          whose padding is pulled out below so every value starts on one edge. */}
      <div ref={list} class="@container/card flex flex-col px-2 pb-2 pt-1.5">
        <Key each={fields().shown} by={(cell) => cell.column.id}>
          {(cell) => {
            const long = () => isLongText(cell());
            return (
              <div
                data-field={cell().column.id}
                class="grid grid-cols-[168px_minmax(0,1fr)] gap-x-3 px-2"
                classList={{
                  // A label sits level with a one-line value of any height (a
                  // person's avatar line is taller than text) and with prose's first line.
                  'items-center @max-[520px]/card:grid-cols-[116px_minmax(0,1fr)] @max-[520px]/card:gap-x-2.5':
                    !long(),
                  'items-start': long(),
                  // On a narrow card, prose drops below its label to take the full width.
                  '@max-[520px]/card:grid-cols-1': long(),
                }}
              >
                <div
                  class="flex h-8 min-w-0 items-center gap-1.5 text-xs text-ink-muted"
                  classList={{
                    '@max-[520px]/card:h-[26px] @max-[520px]/card:items-end':
                      long(),
                  }}
                  title={cell().column.name}
                >
                  <PropertyIcon
                    type={cell().column.dataType}
                    entityType={cell().column.specificEntityType}
                    class="size-3 shrink-0"
                  />
                  <span class="truncate">{cell().column.name}</span>
                </div>
                {/* Pull the cell's padding out so values line up with the column. */}
                <div
                  class="-mx-2.5 min-w-0"
                  classList={{ '@max-[520px]/card:-mt-1': long() }}
                >
                  {props.renderCell(cell, {
                    get fit() {
                      return pipelineCellFit(cell(), fields().clamped);
                    },
                    get emptyLabel() {
                      return cell().column.dataType === 'BOOLEAN'
                        ? undefined
                        : t('crm.pipelineEntryEmpty');
                    },
                  })}
                </div>
              </div>
            );
          }}
        </Key>
        <Show when={fields().folded.length > 0}>
          <button
            type="button"
            class="mt-1 flex h-[34px] min-w-0 items-center gap-2 border-t border-edge-muted px-2 text-left text-[13px] text-ink-subtle outline-none not-touch:hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/50"
            aria-expanded={false}
            aria-label={t('crm.pipelineEntryEmptyFieldsLabel', {
              count: fields().folded.length,
              names: foldedNames(),
            })}
            onClick={openFolded}
          >
            <CaretRightIcon class="size-3 shrink-0" />
            <span class="shrink-0 whitespace-nowrap">
              {t('crm.pipelineEntryEmptyFields', {
                count: fields().folded.length,
              })}
            </span>
            <span class="min-w-0 truncate text-ink-placeholder">
              {foldedNames()}
            </span>
          </button>
        </Show>
      </div>
      <Show when={fields().hidden > 0 || fold() !== 'collapsed'}>
        {/* An expanded card can be taller than the view; its control stays pinned in sight.
            Sticky offsets start inside the record scroller's 3rem bottom padding, so reach past it. */}
        <footer
          class="rounded-b-xl border-t border-edge-muted bg-panel px-4 py-1.5"
          classList={{ 'sticky -bottom-12': fold() !== 'collapsed' }}
        >
          <Button
            variant="ghost"
            size="xs"
            class="-ml-2 text-ink-muted"
            aria-expanded={fold() !== 'collapsed'}
            onClick={toggle}
          >
            {fold() === 'collapsed'
              ? t('crm.pipelineEntryShowMore', { count: fields().hidden })
              : t('crm.pipelineEntryShowLess')}
          </Button>
        </footer>
      </Show>
    </article>
  );
}

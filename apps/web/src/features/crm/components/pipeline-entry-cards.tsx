import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import TableIcon from '@icon/system/regular/table.svg';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui';
import { type Accessor, createSignal, type JSX, Show } from 'solid-js';
import { PropertyIcon } from '../../database/components/property-icon';
import type { PipelineEntry, PipelineEntryCell } from '../core/pipeline-entry';

/** Fields that share a row; the rest wait behind "Show more". */
const ROW_FIELDS = 4;

/** Text takes twice the room of a short value such as a stage or a number. */
function rowColumns(cells: PipelineEntryCell[]) {
  const widths = cells.map((cell) =>
    ['STRING', 'LINK'].includes(cell.column.dataType) ? 2 : 1
  );
  // A short last row keeps every slot so its fields stay their usual width.
  while (widths.length < ROW_FIELDS) widths.push(1);
  return widths.map((width) => `minmax(0, ${width}fr)`).join(' ');
}

function rows(cells: PipelineEntryCell[]) {
  const chunks: PipelineEntryCell[][] = [];
  for (let start = 0; start < cells.length; start += ROW_FIELDS)
    chunks.push(cells.slice(start, start + ROW_FIELDS));
  return chunks;
}

/** One card per pipeline row that references the record. */
export function PipelineEntryCards(props: {
  entries: PipelineEntry[];
  renderCell: (
    entry: Accessor<PipelineEntry>,
    cell: Accessor<PipelineEntryCell>
  ) => JSX.Element;
  onOpenPipeline?: (pipelineId: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <Show when={props.entries.length > 0}>
      <section class="flex flex-col gap-2.5" aria-label="Pipelines">
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
            <span class="text-xs">Pipelines</span>
          </button>
        </h2>
        <Show when={expanded()}>
          <div class="flex flex-col gap-3">
            <Key each={props.entries} by="rowId">
              {(entry) => (
                <PipelineEntryCard
                  entry={entry()}
                  renderCell={(cell) => props.renderCell(entry, cell)}
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
  renderCell: (cell: Accessor<PipelineEntryCell>) => JSX.Element;
  onOpenPipeline?: () => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const hidden = () => props.entry.cells.length - ROW_FIELDS;
  const shown = () => {
    const all = rows(props.entry.cells);
    return expanded() ? all : all.slice(0, 1);
  };
  return (
    <article
      class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-edge-muted bg-panel"
      aria-label={props.entry.pipeline.name}
    >
      <header class="flex h-10 items-center gap-2.5 border-b border-edge-muted bg-hover pl-3.5 pr-1.5">
        <TableIcon class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 truncate text-[13px] font-medium">
          {props.entry.pipeline.name}
        </span>
        <Show when={!props.entry.pipeline.shared}>
          <LockIcon
            role="img"
            aria-label="Private pipeline"
            class="size-3 shrink-0 text-ink-placeholder"
          />
        </Show>
        <span class="flex-1" />
        <Show when={props.onOpenPipeline}>
          {(open) => (
            <Button
              size="icon-sm"
              label={`Open ${props.entry.pipeline.name}`}
              onClick={() => open()()}
            >
              <ArrowUpRightIcon />
            </Button>
          )}
        </Show>
      </header>
      <div class="flex flex-col gap-3 px-4 pb-3.5 pt-3">
        <Key each={shown()} by={(row) => row[0]?.column.id}>
          {(row) => (
            <div
              class="grid gap-x-6"
              style={{ 'grid-template-columns': rowColumns(row()) }}
            >
              <Key each={row()} by={(cell) => cell.column.id}>
                {(cell) => (
                  <div class="flex min-w-0 flex-col gap-1.5">
                    <div
                      class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted"
                      title={cell().column.name}
                    >
                      <PropertyIcon
                        type={cell().column.dataType}
                        entityType={cell().column.specificEntityType}
                        class="size-3 shrink-0"
                      />
                      <span class="truncate">{cell().column.name}</span>
                    </div>
                    {/* Cells pad their own hit area; pull it out to align values with the labels. */}
                    <div class="-mx-2.5 -my-1.5 min-w-0">
                      {props.renderCell(cell)}
                    </div>
                  </div>
                )}
              </Key>
            </div>
          )}
        </Key>
        <Show when={hidden() > 0}>
          <Button
            variant="ghost"
            size="xs"
            class="-ml-2 self-start text-ink-muted"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded() ? 'Show less' : `Show ${hidden()} more`}
          </Button>
        </Show>
      </div>
    </article>
  );
}

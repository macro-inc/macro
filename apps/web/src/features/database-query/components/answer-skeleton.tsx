import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import LightningIcon from '@icon/system/regular/lightning.svg';
import {
  type DatabaseQueryDisplayMode,
  isDatabaseQueryChartMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { cn } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { ResizableAnswer } from './resizable-answer';

/** Header and cell widths; the answer's own columns are unknown until it loads. */
const COLUMN_WIDTHS = ['w-20', 'w-28', 'w-16'];
const ROWS = [0, 1, 2];
const BAR_HEIGHTS = ['h-[45%]', 'h-[80%]', 'h-[60%]', 'h-full', 'h-[35%]'];
const BAR_WIDTHS = ['w-[70%]', 'w-[45%]', 'w-[90%]'];

/** A bar that sits on the text line, so its row keeps the text's height. */
function LineBar(props: { class: string }) {
  return (
    <ListSkeleton.Bar
      class={cn('inline-block h-2 align-middle', props.class)}
    />
  );
}

/** The table `QueryResults` draws, with bars for its header, rows and count. */
function TableSkeleton() {
  return (
    <div class="overflow-hidden rounded-lg border border-edge-muted">
      <table class="w-full border-collapse text-left text-xs">
        <thead class="bg-hover">
          <tr>
            <For each={COLUMN_WIDTHS}>
              {(width) => (
                <th class="border-b border-edge-muted px-3 py-2.5 font-medium">
                  <LineBar class={width} />
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={ROWS}>
            {() => (
              <tr>
                <For each={COLUMN_WIDTHS}>
                  {(width) => (
                    <td class="border-b border-edge-muted/60 px-3 py-2">
                      <LineBar class={width} />
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <div class="px-3 py-2 text-[11px]">
        <LineBar class="w-14" />
      </div>
    </div>
  );
}

/** Bars across, as a category bar chart draws three: 28px a row and 32px of axis. */
function HorizontalBars() {
  return (
    <div class="flex h-[116px] flex-col justify-center gap-2 pb-4">
      <For each={BAR_WIDTHS}>
        {(width) => (
          <div class="flex items-center gap-2">
            <ListSkeleton.Bar class="h-2 w-14 shrink-0" />
            <ListSkeleton.Bar class={cn('h-5 rounded-sm', width)} />
          </div>
        )}
      </For>
    </div>
  );
}

/** Columns up from a baseline, at a line, area or scatter chart's height. */
function VerticalBars() {
  return (
    <div class="flex h-60 items-end justify-center gap-3 px-2">
      <For each={BAR_HEIGHTS}>
        {(height) => (
          <ListSkeleton.Bar class={cn('w-full max-w-12 rounded-sm', height)} />
        )}
      </For>
    </div>
  );
}

/** The figure `QueryChart` draws: a title, the plot or pie, and its data link. */
function ChartSkeleton(props: { displayMode: DatabaseQueryDisplayMode }) {
  return (
    <>
      <div class="min-w-0 space-y-3 rounded-lg border border-edge-muted bg-panel p-3">
        <div class="text-sm">
          <LineBar class="w-32" />
        </div>
        <Switch fallback={<VerticalBars />}>
          <Match when={props.displayMode === 'bar'}>
            <HorizontalBars />
          </Match>
          <Match when={props.displayMode === 'pie'}>
            <div class="flex justify-center">
              <ListSkeleton.Bar class="aspect-square h-auto w-full max-w-70 rounded-full" />
            </div>
          </Match>
        </Switch>
      </div>
      <div class="mt-3 text-xs">
        <LineBar class="w-16" />
      </div>
    </>
  );
}

/** An answer's shape while it loads, in the space the answer will take. */
export function AnswerSkeleton(props: {
  displayMode: DatabaseQueryDisplayMode;
}) {
  return (
    <ListSkeleton.Root label={t('databaseAnswers.loadingAnswer')}>
      <Show
        when={isDatabaseQueryChartMode(props.displayMode)}
        fallback={<TableSkeleton />}
      >
        <ChartSkeleton displayMode={props.displayMode} />
      </Show>
    </ListSkeleton.Root>
  );
}

/** A single value's place in its line while it loads. */
export function ValueSkeleton() {
  return <LineBar class="w-12" />;
}

/**
 * A question's card before its code loads, drawn like `LiveQuestion`'s card so
 * the document does not move when the answer arrives.
 */
export function QuestionCardSkeleton(props: {
  title: string;
  displayMode: DatabaseQueryDisplayMode;
  height?: number;
  /** Leaves room for the resize handle an editor gets. */
  resizable: boolean;
}) {
  return (
    <div class="overflow-hidden rounded-lg border border-edge-muted bg-panel text-ink">
      <div class="flex items-center justify-between gap-2 border-b border-edge-muted px-3 py-2.5">
        <span class="flex min-w-0 items-center gap-2 text-sm font-medium">
          <LightningIcon class="size-3.5 shrink-0 text-ink-muted" />
          <span class="truncate">{props.title}</span>
        </span>
        <span class="shrink-0 px-2 py-1 text-xs text-ink-muted">
          {t('databaseAnswers.details')}
        </span>
      </div>
      <ResizableAnswer height={props.height}>
        <AnswerSkeleton displayMode={props.displayMode} />
      </ResizableAnswer>
      <Show when={props.resizable}>
        <div class="h-3 border-t border-edge-muted" />
      </Show>
    </div>
  );
}

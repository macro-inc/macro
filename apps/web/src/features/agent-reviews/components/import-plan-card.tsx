import CaretDown from '@phosphor/caret-down.svg';
import { ActionDialogShell } from '@ui/components/ActionDialogShell';
import { Button } from '@ui/components/Button';
import { Card } from '@ui/components/Card';
import { Dialog } from '@ui/components/Dialog';
import { cn } from '@ui/utils/classname';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ImportedCopy,
  type ImportPlanEntry,
  type ImportPlanNode,
  type ImportProgress,
  type ImportReviewPhase,
  type ImportTotal,
  type ImportVolume,
  volumeLabel,
} from '../core/import-plan';
import { ImportPlanRow } from './import-plan-row';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function ProgressBar(props: { done: number; total: number }) {
  const percent = () =>
    props.total > 0 ? Math.round((props.done / props.total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label="Import progress"
      aria-valuemin={0}
      aria-valuemax={props.total}
      aria-valuenow={props.done}
      class="h-1.5 w-full overflow-hidden rounded-full bg-edge-muted"
    >
      <div
        class="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${percent()}%` }}
      />
    </div>
  );
}

function PhaseStatus(props: {
  phase: ImportReviewPhase;
  progress: ImportProgress | undefined;
}) {
  const imported = () => props.progress?.imported ?? 0;
  const total = () =>
    imported() +
    (props.progress?.waiting ?? 0) +
    (props.progress?.writing ?? 0);
  // Rebuild only when the phase changes, not on every progress tick.
  const kind = createMemo(() => props.phase.kind);
  const error = () =>
    props.phase.kind === 'failed' || props.phase.kind === 'unknown'
      ? props.phase.error
      : null;
  return (
    <>
      {match(kind())
        .returnType<JSX.Element>()
        .with('preparing', () => (
          <p role="status" class="text-xs text-ink-muted">
            Preparing the import plan…
          </p>
        ))
        .with('planning', 'plan', () => null)
        .with('starting', () => (
          <p role="status" class="text-xs text-ink-muted">
            Starting the import…
          </p>
        ))
        .with('importing', () => (
          <div class="flex flex-col gap-1.5">
            <ProgressBar done={imported()} total={total()} />
            <p role="status" class="text-xs text-ink-muted">
              {imported()} of {total()} imported
              <Show when={(props.progress?.writing ?? 0) > 0}>
                {' '}
                · {props.progress?.writing} writing
              </Show>
            </p>
          </div>
        ))
        .with('completed', () => (
          <p role="status" class="text-sm text-ink">
            Imported {plural(imported(), 'object')}
            <Show when={props.progress?.error}>
              {(error) => <span class="text-failure"> — {error()}</span>}
            </Show>
          </p>
        ))
        .with('stopped', () => (
          <p role="status" class="text-sm text-ink">
            Import stopped — {plural(imported(), 'imported object')}{' '}
            {imported() === 1 ? 'stays' : 'stay'}
          </p>
        ))
        .with('failed', () => (
          <p role="alert" class="text-sm text-failure">
            {error()}
          </p>
        ))
        .with('dismissed', () => (
          <p role="status" class="text-sm text-ink-muted">
            Dismissed — nothing was imported
          </p>
        ))
        .with('unknown', () => (
          <p role="alert" class="text-sm text-failure">
            {error() ??
              'The import may not have started. Check Macro before trying again.'}
          </p>
        ))
        .exhaustive()}
    </>
  );
}

/** Objects a teammate already imported; this import links to their copies. */
function AlreadyInMacro(props: {
  summary: string;
  entries: (ImportPlanEntry & { alreadyImported: ImportedCopy })[];
  entityHref: (copy: ImportedCopy) => string | undefined;
  onOpenEntity: (copy: ImportedCopy, event: MouseEvent) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <section aria-label="Already in Macro" class="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        class="flex min-w-0 items-center gap-1.5 self-start rounded-sm text-left text-xs text-ink-muted touch:min-h-[44px] not-touch:hover:text-ink"
        aria-expanded={expanded()}
        onClick={() => setExpanded(!expanded())}
      >
        <CaretDown
          class={cn(
            'size-3 shrink-0 transition-transform',
            !expanded() && '-rotate-90'
          )}
        />
        <span class="min-w-0 wrap-break-word">{props.summary}</span>
      </button>
      <Show when={expanded()}>
        <ul class="flex min-w-0 flex-col gap-0.5 pl-4.5">
          <For each={props.entries}>
            {(entry) => {
              const title = () => entry.title || 'Untitled';
              const href = () => props.entityHref(entry.alreadyImported);
              return (
                <li class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 py-1 text-sm touch:min-h-[44px]">
                  <Show
                    when={href()}
                    fallback={<span class="min-w-0 truncate">{title()}</span>}
                  >
                    {(link) => (
                      <a
                        href={link()}
                        class="min-w-0 truncate text-ink underline decoration-edge underline-offset-2 not-touch:hover:decoration-ink"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => {
                          event.preventDefault();
                          props.onOpenEntity(entry.alreadyImported, event);
                        }}
                      >
                        {title()}
                      </a>
                    )}
                  </Show>
                  <span class="min-w-0 truncate text-xs text-ink-muted">
                    by {entry.alreadyImported.by}
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </section>
  );
}

type ImportPlanCardProps = {
  title: string;
  summary: string;
  /** e.g. "12 shared with your team · 3 only you". */
  sharingSummary: string;
  /** What the plan holds per kind. */
  totals: ImportTotal[];
  /** What planning is doing, while the plan is still being made. */
  planningStatus: string;
  alreadyInMacroSummary: string;
  /** Objects a teammate already imported, left out of the plan tree. */
  alreadyInMacro: (ImportPlanEntry & { alreadyImported: ImportedCopy })[];
  /** Where a teammate's copy opens; `undefined` when it cannot be linked. */
  entityHref: (copy: ImportedCopy) => string | undefined;
  onOpenEntity: (copy: ImportedCopy, event: MouseEvent) => void;
  phase: ImportReviewPhase;
  progress: ImportProgress | undefined;
  nodes: ImportPlanNode[];
  hasPlan: boolean;
  isCollapsed: (id: string) => boolean;
  isShowingRows: (id: string) => boolean;
  isExcluded: (id: string) => boolean;
  isShared: (id: string) => boolean;
  /** The viewer may trim, approve, and stop this import. */
  canAct: boolean;
  /** Trimming and approving are open. */
  editable: boolean;
  /** The agent approved it because the owner told it to in chat. */
  startedByAgent: boolean;
  working: boolean;
  stopping: boolean;
  count: number;
  volume: ImportVolume;
  alert?: string;
  onReload?: () => void;
  onToggleExpanded: (id: string) => void;
  onToggleRows: (id: string) => void;
  onIncludedChange: (id: string, included: boolean) => void;
  onSharedChange: (id: string, shared: boolean) => void;
  onApprove: () => void;
  onDismiss: () => void;
  onStop: () => void;
};

/** What the plan holds per kind, e.g. "Databases 18 (405 rows)". */
function PlanTotals(props: { totals: ImportTotal[] }) {
  return (
    <Show when={props.totals.length > 0}>
      <dl
        aria-label="Plan totals"
        class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs"
      >
        <For each={props.totals}>
          {(total) => (
            <div class="flex items-baseline gap-1">
              <dt class="text-ink-muted">{total.label}</dt>
              <dd class="text-ink">{total.value}</dd>
            </div>
          )}
        </For>
      </dl>
    </Show>
  );
}

/**
 * The plan and its progress. The card shows it in a short scrolling list;
 * `full` shows the whole tree in the full review.
 */
function PlanContents(
  props: ImportPlanCardProps & { full: boolean; onOpenFull?: () => void }
) {
  const choosing = () => props.phase.kind === 'plan';
  const planning = () => props.phase.kind === 'planning';
  const running = () =>
    props.phase.kind === 'starting' || props.phase.kind === 'importing';
  const failures = () => props.progress?.failures ?? [];
  return (
    <>
      <header class="flex min-w-0 flex-col gap-0.5">
        <Show
          when={props.full}
          fallback={
            <h3 class="text-sm font-semibold text-ink">{props.title}</h3>
          }
        >
          <ActionDialogShell.Title>{props.title}</ActionDialogShell.Title>
        </Show>
        <Show when={props.summary}>
          <p class="text-xs text-ink-muted">{props.summary}</p>
        </Show>
        <Show when={(choosing() || planning()) && props.sharingSummary}>
          <p class="text-xs text-ink-muted">{props.sharingSummary}</p>
        </Show>
      </header>
      <PlanTotals totals={props.totals} />
      <Show when={props.alert}>
        <div class="flex flex-wrap items-center gap-2">
          <p role="alert" class="text-sm text-failure">
            {props.alert}
          </p>
          <Show when={props.onReload}>
            {(reload) => (
              <Button
                variant="outline"
                size="sm"
                disabled={props.working}
                onClick={() => reload()()}
              >
                Reload saved review
              </Button>
            )}
          </Show>
        </div>
      </Show>
      <Show
        when={planning()}
        fallback={<PhaseStatus phase={props.phase} progress={props.progress} />}
      >
        <p role="status" class="text-xs text-ink-muted">
          {props.planningStatus}
        </p>
      </Show>
      <Show when={props.startedByAgent}>
        <p class="text-xs text-ink-muted">
          {props.canAct
            ? 'Started by the agent at your request'
            : "Started by the agent at the owner's request"}
        </p>
      </Show>
      <Show
        when={props.hasPlan}
        fallback={
          <Show when={!planning()}>
            <p class="text-xs text-ink-muted">
              {props.alreadyInMacro.length > 0
                ? 'Everything Notion shared is already in Macro.'
                : 'The plan has no objects to show.'}
            </p>
          </Show>
        }
      >
        <ul
          aria-label="Import plan"
          class={cn(
            'min-w-0 overflow-x-hidden',
            props.full
              ? 'min-h-0 flex-1 overflow-y-auto'
              : 'max-h-80 overflow-y-auto'
          )}
        >
          <For each={props.nodes}>
            {(node) => (
              <ImportPlanRow
                node={node}
                collapsed={props.isCollapsed(node.id)}
                showingRows={props.isShowingRows(node.id)}
                excluded={props.isExcluded(node.id)}
                shared={props.isShared(node.id)}
                choosing={(choosing() || planning()) && props.canAct}
                disabled={!props.editable}
                showStatus={
                  !choosing() && !planning() && props.phase.kind !== 'preparing'
                }
                onToggleExpanded={() => props.onToggleExpanded(node.id)}
                onToggleRows={() => props.onToggleRows(node.id)}
                onIncludedChange={(included) =>
                  props.onIncludedChange(node.id, included)
                }
                onSharedChange={(shared) =>
                  props.onSharedChange(node.id, shared)
                }
              />
            )}
          </For>
        </ul>
        <Show when={props.onOpenFull}>
          {(open) => (
            <Button
              variant="ghost"
              size="sm"
              class="self-start"
              onClick={() => open()()}
            >
              Open full review
            </Button>
          )}
        </Show>
      </Show>
      <Show when={props.alreadyInMacro.length > 0}>
        <AlreadyInMacro
          summary={props.alreadyInMacroSummary}
          entries={props.alreadyInMacro}
          entityHref={props.entityHref}
          onOpenEntity={props.onOpenEntity}
        />
      </Show>
      <Show when={failures().length > 0}>
        <section aria-label="Failures" class="flex flex-col gap-1">
          <h4 class="text-xs font-medium text-ink-muted">
            {plural(failures().length, 'object')} couldn't be imported
          </h4>
          <ul class="flex flex-col gap-0.5">
            <For each={failures()}>
              {(failure) => (
                <li class="min-w-0 text-xs text-ink-muted wrap-break-word">
                  <span class="text-ink">{failure.title || 'Untitled'}</span>
                  <Show when={failure.reason}> — {failure.reason}</Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      <Show when={props.canAct && (choosing() || planning())}>
        <footer class="flex flex-wrap items-center justify-end gap-2">
          <p class="mr-auto min-w-0 text-xs text-ink-muted">
            You can stop the import while it runs; anything already imported
            stays.
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.editable}
            onClick={() => props.onDismiss()}
          >
            Dismiss
          </Button>
          <Button
            variant="cta"
            size="sm"
            disabled={!props.editable || props.count === 0}
            onClick={() => props.onApprove()}
          >
            {planning() ? 'Import' : `Import ${volumeLabel(props.volume)}`}
          </Button>
        </footer>
      </Show>
      <Show when={props.canAct && running()}>
        <footer class="flex justify-end">
          <Button
            variant="danger"
            size="sm"
            disabled={props.stopping}
            onClick={() => props.onStop()}
          >
            {props.stopping ? 'Stopping…' : 'Stop'}
          </Button>
        </footer>
      </Show>
    </>
  );
}

/**
 * A Notion workspace import plan: filled in while it is planned, trimmed
 * and approved, then its progress. "Open full review" shows the whole plan
 * in a dialog, a full-height sheet on phones.
 */
export function ImportPlanCard(props: ImportPlanCardProps) {
  const [full, setFull] = createSignal(false);
  return (
    <>
      <Card class="my-3 flex min-w-0 flex-col gap-3 p-3">
        <PlanContents
          {...props}
          full={false}
          onOpenFull={() => setFull(true)}
        />
      </Card>
      <Dialog open={full()} onOpenChange={setFull}>
        <ActionDialogShell class="h-[85dvh] max-h-[85dvh] mobile:h-auto mobile:max-h-none">
          <ActionDialogShell.Body class="flex min-h-0 flex-1 flex-col gap-3 space-y-0">
            <PlanContents {...props} full />
          </ActionDialogShell.Body>
        </ActionDialogShell>
      </Dialog>
    </>
  );
}

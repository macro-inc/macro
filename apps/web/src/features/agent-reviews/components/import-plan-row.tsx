import { EntityIcon } from '@core/component/EntityIcon';
import CaretDown from '@icon/system/regular/caret-down.svg';
import { Badge, badgeTriggerClasses } from '@ui/components/Badge';
import { Checkbox } from '@ui/components/Checkbox';
import { Tooltip } from '@ui/components/Tooltip';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ImportPlanDecision,
  type ImportPlanNode,
  type ImportTaskFields,
  isWritten,
} from '../core/import-plan';

/** Deeper levels share the last indent so rows fit a phone-width transcript. */
const MAX_INDENT_LEVEL = 4;

function decisionLabel(decision: ImportPlanDecision | null): string {
  return match(decision)
    .with('copy', () => 'Copy')
    .with('tasks', () => 'Tasks')
    .with('skip', () => 'Skip')
    .with('hand', () => 'Needs you')
    .with(null, () => 'Deciding…')
    .exhaustive();
}

/** e.g. "2,365 tasks — Fix login redirect, Q3 pricing page, …". */
function rowsLine(node: ImportPlanNode, showEstimate: boolean): string {
  const titles = node.sampleTitles.map((title) => title || 'Untitled');
  if (!showEstimate) {
    return titles.length > 0 ? `Plan sample — ${titles.join(', ')}` : '';
  }
  const count = (node.rows ?? node.sampleTitles.length).toLocaleString('en-US');
  const noun = node.decision === 'tasks' ? 'tasks' : 'rows';
  const more =
    (node.rows ?? 0) > node.sampleTitles.length && node.sampleTitles.length > 0
      ? ', …'
      : '';
  return titles.length > 0
    ? `${count} ${noun} — ${titles.join(', ')}${more}`
    : `${count} ${noun}`;
}

/** e.g. "Status from “Stage” · Due from “Deadline”". */
function taskFieldsLine(fields: ImportTaskFields): string {
  return [
    fields.status ? `Status from “${fields.status}”` : '',
    fields.priority ? `Priority from “${fields.priority}”` : '',
    fields.due ? `Due from “${fields.due}”` : '',
    fields.assignee ? `Assignee from “${fields.assignee}”` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function DecisionBadge(props: {
  link: boolean;
  decision: ImportPlanDecision | null;
  reason: string | null;
}) {
  const badge = () => (
    <Badge
      size="xs"
      variant="outline"
      class={cn(
        props.decision === 'tasks' && 'text-accent',
        props.decision === 'hand' && 'text-warning',
        (props.decision === 'skip' || props.decision === null) &&
          'text-ink-extra-muted'
      )}
    >
      {props.link ? 'Link' : decisionLabel(props.decision)}
    </Badge>
  );
  return (
    <Show when={props.reason} fallback={badge()}>
      {(reason) => (
        <Tooltip label={reason()} as="span" tabIndex={0}>
          {badge()}
        </Tooltip>
      )}
    </Show>
  );
}

function SharingBadge(props: {
  title: string;
  shared: boolean;
  reason: string | null;
  /** The owner can flip it here. */
  toggleable: boolean;
  muted: boolean;
  onSharedChange: (shared: boolean) => void;
}) {
  const label = () => (props.shared ? 'Team' : 'Only you');
  const tone = () =>
    cn(
      props.shared && !props.muted ? 'text-accent' : 'text-ink-muted',
      props.muted && 'opacity-60'
    );
  const badge = () => (
    <Show
      when={props.toggleable}
      fallback={
        <Badge size="xs" variant="outline" class={tone()}>
          {label()}
        </Badge>
      }
    >
      <button
        type="button"
        aria-pressed={props.shared}
        aria-label={
          props.shared
            ? `Make ${props.title} only visible to you`
            : `Share ${props.title} with your team`
        }
        class={badgeTriggerClasses({
          variant: 'outline',
          size: 'xs',
          class: cn('touch:h-8 touch:px-3', tone()),
        })}
        onClick={() => props.onSharedChange(!props.shared)}
      >
        {label()}
      </button>
    </Show>
  );
  return (
    <Show when={props.reason} fallback={badge()}>
      {(reason) => (
        <Tooltip
          label={reason()}
          as="span"
          tabIndex={props.toggleable ? undefined : 0}
        >
          {badge()}
        </Tooltip>
      )}
    </Show>
  );
}

function RowStatus(props: { node: ImportPlanNode; excluded: boolean }) {
  return (
    <Show
      when={props.node.error}
      fallback={
        <span class="shrink-0 text-xs text-ink-muted">
          {match(props.node.status)
            .with('imported', () => 'Imported')
            .with('importing', () => 'Writing…')
            .with('discarded', () =>
              props.node.decision === 'hand' ? 'Needs you' : 'Left out'
            )
            .with('staged', () =>
              props.node.decision === 'hand'
                ? 'Needs you'
                : isWritten(props.node.decision) && !props.excluded
                  ? 'Waiting'
                  : ''
            )
            .exhaustive()}
        </span>
      }
    >
      <span class="shrink-0 text-xs text-failure">Failed</span>
    </Show>
  );
}

/** One Notion object in the plan tree. */
export function ImportPlanRow(props: {
  node: ImportPlanNode;
  collapsed: boolean;
  /** A database's sample rows and task columns are showing. */
  showingRows: boolean;
  excluded: boolean;
  /** Shared with the owner's team when written. */
  shared: boolean;
  /** Show the checkbox that leaves the object out, and the sharing toggle. */
  choosing: boolean;
  disabled: boolean;
  /** Show how the write went instead of the plan. */
  showStatus: boolean;
  /** Keep plan samples without their estimate after confirmed counts arrive. */
  showRowEstimate?: boolean;
  onToggleExpanded: () => void;
  onToggleRows: () => void;
  onIncludedChange: (included: boolean) => void;
  onSharedChange: (shared: boolean) => void;
}) {
  const written = () => isWritten(props.node.decision);
  const showRowEstimate = () => props.showRowEstimate !== false;
  const included = () => written() && !props.excluded;
  const hasRows = () =>
    props.node.kind === 'database' &&
    (props.node.sampleTitles.length > 0 || props.node.taskFields !== null);
  const linkedFrom = () =>
    props.node.linkedFrom?.length ? props.node.linkedFrom : props.node.inlineOn;
  const indent = () => `${Math.min(props.node.depth, MAX_INDENT_LEVEL) * 12}px`;
  return (
    <li
      class={cn(
        'flex min-w-0 flex-col',
        !included() && !props.showStatus && 'text-ink-muted',
        props.showStatus &&
          props.node.status === 'discarded' &&
          props.node.decision !== 'hand' &&
          'opacity-60'
      )}
    >
      <div
        class="flex min-w-0 items-center gap-1.5 py-1 pr-1 touch:min-h-[44px] mobile:flex-wrap"
        style={{ 'padding-left': indent() }}
      >
        <Show
          when={props.node.childIds.length > 0}
          fallback={
            <Show
              when={hasRows()}
              fallback={
                <span class="size-4 shrink-0 touch:size-8" aria-hidden="true" />
              }
            >
              <button
                type="button"
                class="flex size-4 shrink-0 items-center justify-center rounded-sm text-ink-muted touch:size-8 not-touch:hover:text-ink"
                aria-expanded={props.showingRows}
                aria-label={`${props.showingRows ? 'Hide' : 'Show'} rows of ${props.node.title || 'Untitled'}`}
                onClick={() => props.onToggleRows()}
              >
                <CaretDown
                  class={cn(
                    'size-3 transition-transform',
                    !props.showingRows && '-rotate-90'
                  )}
                />
              </button>
            </Show>
          }
        >
          <button
            type="button"
            class="flex size-4 shrink-0 items-center justify-center rounded-sm text-ink-muted touch:size-8 not-touch:hover:text-ink"
            aria-expanded={!props.collapsed}
            aria-label={`${props.collapsed ? 'Show' : 'Hide'} what is inside ${props.node.title}`}
            onClick={() => props.onToggleExpanded()}
          >
            <CaretDown
              class={cn(
                'size-3 transition-transform',
                props.collapsed && '-rotate-90'
              )}
            />
          </button>
        </Show>
        <Show when={props.choosing}>
          <Checkbox
            checked={included()}
            disabled={props.disabled || !written()}
            onChange={(checked) => props.onIncludedChange(checked)}
          >
            <Checkbox.Control />
            <Checkbox.Label class="sr-only">
              Import {props.node.title}
            </Checkbox.Label>
          </Checkbox>
        </Show>
        <EntityIcon
          targetType={match(props.node.kind)
            .with('database', () => 'database' as const)
            .with('task', () => 'task' as const)
            .with('project', () => 'initiative' as const)
            .with('page', () => 'md' as const)
            .with('pipeline', () => 'pipeline' as const)
            .with('company', () => 'crm_company' as const)
            .with('contact', () => 'contact' as const)
            .with('deal', () => 'pipeline' as const)
            .exhaustive()}
          size="xs"
        />
        <span class="flex min-w-0 flex-1 flex-col mobile:contents">
          <span
            class="truncate text-sm mobile:min-w-0 mobile:flex-1 mobile:whitespace-normal mobile:wrap-break-word"
            title={props.node.title}
          >
            {props.node.title || 'Untitled'}
          </span>
          <Show when={linkedFrom()?.length}>
            <span
              class="truncate text-xs text-ink-muted mobile:order-last mobile:basis-full mobile:whitespace-normal mobile:wrap-break-word"
              title={linkedFrom()?.join(', ')}
            >
              Linked from {linkedFrom()?.join(', ')}
            </span>
          </Show>
          <Show when={props.node.decision === 'hand' && props.node.reason}>
            <span class="truncate text-xs text-ink-muted mobile:order-last mobile:basis-full mobile:whitespace-normal mobile:wrap-break-word">
              {props.node.reason}
            </span>
          </Show>
        </span>
        <span class="contents mobile:order-1 mobile:flex mobile:basis-full mobile:flex-wrap mobile:items-center mobile:justify-end mobile:gap-1.5">
          <Show
            when={
              showRowEstimate() &&
              props.node.kind === 'database' &&
              props.node.rows !== null
            }
          >
            <span class="shrink-0 text-xs text-ink-muted">
              {props.node.rows} rows
            </span>
          </Show>
          <Show when={written()}>
            <SharingBadge
              title={props.node.title || 'Untitled'}
              shared={props.shared}
              reason={props.node.sharedReason}
              toggleable={
                props.node.shareable && props.choosing && !props.disabled
              }
              muted={props.excluded}
              onSharedChange={(shared) => props.onSharedChange(shared)}
            />
          </Show>
          <Show
            when={props.showStatus}
            fallback={
              <DecisionBadge
                link={
                  isWritten(props.node.decision) &&
                  Boolean(props.node.linkedFrom?.length) &&
                  props.excluded
                }
                decision={props.node.decision}
                reason={props.node.reason}
              />
            }
          >
            <RowStatus node={props.node} excluded={props.excluded} />
          </Show>
        </span>
      </div>
      <Show when={hasRows() && props.showingRows}>
        <div
          class="flex min-w-0 flex-col gap-0.5 pb-1.5 pr-1 text-xs text-ink-muted"
          style={{ 'padding-left': `calc(${indent()} + 1.375rem)` }}
        >
          <Show when={rowsLine(props.node, showRowEstimate())}>
            {(line) => <p class="wrap-break-word">{line()}</p>}
          </Show>
          <Show
            when={
              props.node.decision === 'tasks' ? props.node.taskFields : null
            }
          >
            {(fields) => (
              <Show when={taskFieldsLine(fields())}>
                {(line) => <p class="wrap-break-word">{line()}</p>}
              </Show>
            )}
          </Show>
        </div>
      </Show>
    </li>
  );
}

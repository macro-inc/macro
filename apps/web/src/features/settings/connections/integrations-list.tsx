import { rowPillClasses } from '@app/features/entity/components/row-pill';
import { TAG_COLORS } from '@app/features/property/tags/tagColors';
import { Badge, cn, TagDot } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { settingsTarget } from '../core/settings-target';
import { type ConnectionState, StatusDot } from '../integration-ui';

/** Whether an integration is in use; connected rows sort to the top. */
export type IntegrationStatus = ConnectionState | 'available';

/**
 * How an integration reaches Macro: built into Macro (`native`), or as tools
 * agents call through an MCP server (`mcp`).
 */
export type IntegrationKind = 'native' | 'mcp';

/** One row of the Integrations list. */
export type IntegrationItem = {
  id: string;
  name: string;
  kind: IntegrationKind;
  icon: JSX.Element;
  /** What it does in Macro, or which accounts are connected. */
  description: string;
  categories: string[];
  status: IntegrationStatus;
  /** Overrides the status word, e.g. "Reconnect required". */
  statusLabel?: string;
  /** Rendered in the row's trailing cell; reads its own reactive state. */
  Actions: Component;
};

const CATEGORY_COLORS: Record<string, string> = {
  Email: TAG_COLORS[0],
  Calendar: TAG_COLORS[7],
  Chat: TAG_COLORS[9],
  Tasks: TAG_COLORS[8],
  Docs: TAG_COLORS[6],
  Code: TAG_COLORS[11],
  Meetings: TAG_COLORS[5],
  'AI apps': TAG_COLORS[3],
  'Agent tools': TAG_COLORS[2],
  'Custom MCP': TAG_COLORS[11],
};

/** Known categories keep their color; catalog categories get a stable one. */
function categoryColor(category: string): string {
  const known = CATEGORY_COLORS[category];
  if (known) return known;
  let hash = 0;
  for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

function statusWord(
  status: IntegrationStatus,
  label: string | undefined
): string | undefined {
  if (label) return label;
  return match(status)
    .with('connected', () => 'Connected')
    .with('attention', () => 'Needs attention')
    .with('disconnected', () => 'Off')
    .with('available', () => undefined)
    .exhaustive();
}

/** Matches the name, description and categories, ignoring case. */
export function matchesIntegration(
  item: Pick<IntegrationItem, 'name' | 'description' | 'categories'>,
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.description, ...item.categories]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

export function CategoryTags(props: { categories: string[] }) {
  return (
    <div class="flex min-w-0 items-center gap-1 overflow-hidden">
      <For each={props.categories}>
        {(category) => (
          <span title={category} class={rowPillClasses('max-w-full shrink')}>
            <TagDot fill={categoryColor(category)} size="sm" />
            <span class="min-w-0 truncate">{category}</span>
          </span>
        )}
      </For>
    </div>
  );
}

/**
 * The list's columns. Category and status drop out on narrow containers, where
 * the status dot moves beside the name.
 */
function Columns(props: {
  class?: string;
  children: JSX.Element;
  role: 'row';
  /** Label the settings search reveals this row by. */
  target?: string;
}) {
  return (
    <div
      role={props.role}
      data-settings-target={settingsTarget(props.target)}
      class={cn(
        'grid items-center gap-3 grid-cols-[minmax(0,1fr)_auto]',
        '@[640px]/integrations:grid-cols-[minmax(0,1fr)_15rem_7rem_12.5rem]',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

export function IntegrationsListHeader() {
  return (
    <Columns
      role="row"
      class="h-8 border-b border-ink/5 px-3 text-xs font-medium text-ink-extra-muted"
    >
      <span role="columnheader">Name</span>
      <span role="columnheader" class="hidden @[640px]/integrations:block">
        Category
      </span>
      <span role="columnheader" class="hidden @[640px]/integrations:block">
        Status
      </span>
      <span role="columnheader" class="sr-only">
        Actions
      </span>
    </Columns>
  );
}

export function IntegrationListRow(props: {
  icon: JSX.Element;
  name: string;
  kind: IntegrationKind;
  description: string;
  categories: string[];
  status: IntegrationStatus;
  statusLabel?: string;
  /** Soften the row when the integration is paused. */
  muted?: boolean;
  children?: JSX.Element;
}) {
  const word = () => statusWord(props.status, props.statusLabel);
  const dotState = () =>
    props.status === 'available' ? undefined : props.status;
  return (
    <Columns
      role="row"
      target={props.name}
      class="min-h-14 rounded-lg px-3 py-2 text-sm not-touch:hover:bg-list-hover focus-within:bg-list-hover"
    >
      <div role="cell" class="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          class={cn(
            'flex size-5 shrink-0 items-center justify-center [&_img]:size-5 [&_svg]:size-5',
            props.muted && 'opacity-50'
          )}
        >
          {props.icon}
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class={cn(
                'min-w-0 truncate font-medium',
                props.muted ? 'text-ink-muted' : 'text-ink'
              )}
            >
              {props.name}
            </span>
            <Badge
              variant="outline"
              size="xs"
              class="shrink-0 text-ink-muted"
              title={
                props.kind === 'mcp'
                  ? 'Agents use it through an MCP server'
                  : 'Built into Macro'
              }
            >
              {props.kind}
            </Badge>
            <Show when={dotState()}>
              {(state) => (
                <span class="flex @[640px]/integrations:hidden">
                  <StatusDot state={state()} label={word()} />
                </span>
              )}
            </Show>
          </div>
          <span
            class="ph-no-capture min-w-0 truncate text-xs text-ink-extra-muted"
            title={props.description}
          >
            {props.description}
          </span>
        </div>
      </div>
      <div role="cell" class="hidden min-w-0 @[640px]/integrations:block">
        <CategoryTags categories={props.categories} />
      </div>
      <div
        role="cell"
        class="hidden items-center gap-1.5 text-xs text-ink-muted @[640px]/integrations:flex"
      >
        <Show when={dotState()}>
          {(state) => <StatusDot state={state()} />}
        </Show>
        <span>{word() ?? '—'}</span>
      </div>
      <div role="cell" class="flex shrink-0 items-center justify-end gap-1">
        {props.children}
      </div>
    </Columns>
  );
}

/** Renders an item from the integration sources. */
export function IntegrationItemRow(props: { item: IntegrationItem }) {
  return (
    <IntegrationListRow
      icon={props.item.icon}
      name={props.item.name}
      kind={props.item.kind}
      description={props.item.description}
      categories={props.item.categories}
      status={props.item.status}
      statusLabel={props.item.statusLabel}
      muted={props.item.status === 'disconnected'}
    >
      <props.item.Actions />
    </IntegrationListRow>
  );
}

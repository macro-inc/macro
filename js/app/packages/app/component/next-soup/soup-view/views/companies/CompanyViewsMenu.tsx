import type { Query } from '@app/component/next-soup/filters/filter-store';
import { useSoupView } from '@app/component/next-soup/soup-view/soup-view-context';
import {
  CRM_KANBAN_FIELD_LABELS,
  CRM_LIST_COLUMN_LABELS,
  type CrmKanbanFieldId,
  type CrmListColumnId,
  useCrmDisplayOptions,
} from '@companies/crm/display-options';
import {
  buildCrmViewShareUrl,
  type CrmViewConfig,
  usePersonalCrmViews,
  useTeamCrmViews,
} from '@companies/crm/saved-views';
import { useCrmPermissions } from '@companies/crm/team-crm-config';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import FloppyDiskIcon from '@phosphor/floppy-disk.svg';
import LinkIcon from '@phosphor/link.svg';
import SlidersIcon from '@phosphor/sliders-horizontal.svg';
import StackIcon from '@phosphor/stack.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Button, cn, Dropdown, SegmentedControl, Tooltip } from '@ui';
import { batch, createSignal, For, type JSX, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';

type SoupViewMode = 'list' | 'board';

/** Copy a view's share link, with a toast either way. */
const copyShareLink = (config: CrmViewConfig) => {
  navigator.clipboard
    .writeText(buildCrmViewShareUrl(config))
    .then(() => toast.success('Link copied to clipboard'))
    .catch(() => toast.failure('Failed to copy link'));
};

/**
 * Saved-view row: the name applies the view; trailing hover actions copy
 * its share link or delete it.
 */
const SavedViewRow = (props: {
  name: string;
  onApply: () => void;
  onCopyLink: () => void;
  onDelete?: () => void;
}) => (
  <div class="group rounded-lg w-full flex items-center gap-0.5 pl-2 pr-1 hover:bg-ink/5">
    <button
      type="button"
      class="flex-1 min-w-0 truncate py-1.5 text-left text-sm"
      onClick={props.onApply}
    >
      {props.name}
    </button>
    <Tooltip label="Copy link">
      <Button
        variant="ghost"
        size="icon-sm"
        label="Copy link"
        class="size-6 shrink-0 rounded-md p-1 text-ink-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={props.onCopyLink}
      >
        <LinkIcon class="size-3.5" />
      </Button>
    </Tooltip>
    <Show when={props.onDelete}>
      {(onDelete) => (
        <Tooltip label="Delete view">
          <Button
            variant="ghost"
            size="icon-sm"
            label="Delete view"
            class="size-6 shrink-0 rounded-md p-1 text-ink-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => onDelete()()}
          >
            <TrashIcon class="size-3.5" />
          </Button>
        </Tooltip>
      )}
    </Show>
  </div>
);

const EmptyViewsHint = (props: { children: JSX.Element }) => (
  <div class="px-2 py-1.5 text-xs text-ink-extra-muted">{props.children}</div>
);

/**
 * Saved-views dropdown for the Customers view: personal and team-shared
 * snapshots of the full view state (filters, search, grouping, sort,
 * list/board mode, stage/owner sub-filters, tab), plus share links that
 * encode the same state into the URL (see `@companies/crm/saved-views`).
 */
export function CompanyViewsMenu(props: {
  viewMode: SoupViewMode;
  setViewMode: (mode: SoupViewMode) => void;
}) {
  const {
    soup,
    queryFilters,
    searchText,
    setSearchText,
    stageFilter,
    setStageFilter,
    ownerFilter,
    setOwnerFilter,
    activeTab,
    setActiveTab,
  } = useSoupView();
  const personal = usePersonalCrmViews();
  const team = useTeamCrmViews();
  const { canEditCrm } = useCrmPermissions();
  const userId = useUserId();

  const [open, setOpen] = createSignal(false);
  const [saveFormOpen, setSaveFormOpen] = createSignal(false);
  const [saveName, setSaveName] = createSignal('');
  const [saveScope, setSaveScope] = createSignal<'personal' | 'team'>(
    'personal'
  );

  const captureCurrentView = (): CrmViewConfig => ({
    kind: 'crm',
    // JSON-safe snapshot — the store's state must not leak by reference.
    filters: structuredClone(unwrap(queryFilters.state)),
    clientFilters: {
      and: [...soup.predicates.andIds()],
      or: [...soup.predicates.orIds()],
    },
    searchText: searchText(),
    groupBy: soup.grouping.activeGroupId() ?? null,
    sort: soup.sort.active().map((s) => s.id),
    viewMode: props.viewMode,
    stageFilter: [...stageFilter()],
    ownerFilter: [...ownerFilter()],
    activeTab: activeTab(),
  });

  // Mirrors the init/applyTabPreset path: replace filters + predicates
  // atomically, then re-derive the stage/owner predicate active state from
  // the saved sub-filter selections (same rule as handleStageChange /
  // handleOwnerChange in unified-filter-dropdown).
  const applyView = (config: CrmViewConfig) => {
    batch(() => {
      queryFilters.replace((config.filters as Query | undefined) ?? null);
      soup.predicates.set(config.clientFilters ?? {});
      setSearchText(config.searchText ?? '');
      // `groupBy: null` records an explicit "no grouping"; the grouping
      // store expresses that as `undefined` (same as the init path).
      soup.grouping.setActiveGroupId(config.groupBy ?? undefined);
      soup.sort.setAll(
        (config.sort?.length ? config.sort : ['updated_at']) as Parameters<
          typeof soup.sort.setAll
        >[0]
      );
      const stages = config.stageFilter ?? [];
      setStageFilter(stages);
      if (stages.length > 0 !== soup.predicates.isActive('company-stage')) {
        soup.predicates.toggle({ and: ['company-stage'] });
      }
      const owners = config.ownerFilter ?? [];
      setOwnerFilter(owners);
      if (owners.length > 0 !== soup.predicates.isActive('company-owner')) {
        soup.predicates.toggle({ and: ['company-owner'] });
      }
      props.setViewMode(config.viewMode ?? 'list');
      if (config.activeTab !== undefined) setActiveTab(config.activeTab);
    });
    setOpen(false);
  };

  const saveCurrentView = () => {
    const name = saveName().trim();
    if (!name) return;
    const config = captureCurrentView();
    if (saveScope() === 'team') {
      team.add(name, config);
    } else {
      personal.create.mutate({ name, config });
    }
    setSaveFormOpen(false);
    setSaveName('');
    setOpen(false);
    toast.success('View saved');
  };

  const canDeleteTeamView = (createdBy: string | undefined) =>
    canEditCrm() || (createdBy !== undefined && createdBy === userId());

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setSaveFormOpen(false);
      setSaveName('');
    }
  };

  return (
    <Dropdown open={open()} onOpenChange={handleOpenChange}>
      <Dropdown.Trigger depth={2} class="bg-surface">
        <StackIcon />
        <span>Views</span>
      </Dropdown.Trigger>

      <Dropdown.Content class="w-64 shadow-menu">
        <Dropdown.Group>
          <Dropdown.GroupLabel>My views</Dropdown.GroupLabel>
          <For
            each={personal.views()}
            fallback={<EmptyViewsHint>No saved views</EmptyViewsHint>}
          >
            {(view) => (
              <SavedViewRow
                name={view.name}
                onApply={() => applyView(view.config)}
                onCopyLink={() => copyShareLink(view.config)}
                onDelete={() => personal.remove.mutate({ id: view.id })}
              />
            )}
          </For>
        </Dropdown.Group>

        <Dropdown.Group>
          <Dropdown.GroupLabel>Team views</Dropdown.GroupLabel>
          <For
            each={team.views()}
            fallback={<EmptyViewsHint>No team views</EmptyViewsHint>}
          >
            {(view) => (
              <SavedViewRow
                name={view.name}
                onApply={() => applyView(view.config as CrmViewConfig)}
                onCopyLink={() => copyShareLink(view.config as CrmViewConfig)}
                onDelete={
                  canDeleteTeamView(view.createdBy)
                    ? () => team.remove(view.id)
                    : undefined
                }
              />
            )}
          </For>
        </Dropdown.Group>

        <Dropdown.Group>
          <Show
            when={saveFormOpen()}
            fallback={
              <Dropdown.Item
                closeOnSelect={false}
                onSelect={() => setSaveFormOpen(true)}
              >
                <FloppyDiskIcon class="size-3.5 shrink-0 text-ink-muted" />
                <span class="flex-1 truncate">Save current view…</span>
              </Dropdown.Item>
            }
          >
            <div class="flex flex-col gap-1.5 p-1.5">
              <input
                ref={(el) => requestAnimationFrame(() => el.focus())}
                value={saveName()}
                onInput={(e) => setSaveName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // Keep character keys / Enter away from the menu's
                  // typeahead and item selection; Escape still closes.
                  if (e.key === 'Escape') return;
                  e.stopPropagation();
                  if (e.key === 'Enter') saveCurrentView();
                }}
                placeholder="View name"
                class={cn(
                  'w-full rounded-md border border-edge-muted bg-transparent px-2 py-1 text-sm',
                  'outline-none focus:border-accent placeholder:text-ink-faint'
                )}
              />
              <div class="flex items-center justify-between gap-1.5">
                <SegmentedControl
                  size="sm"
                  aria-label="View visibility"
                  value={saveScope()}
                  onChange={(value) => setSaveScope(value)}
                  options={[
                    { value: 'personal', label: 'Personal' },
                    { value: 'team', label: 'Team' },
                  ]}
                />
                <Button
                  variant="base"
                  size="sm"
                  disabled={!saveName().trim()}
                  onClick={saveCurrentView}
                >
                  Save
                </Button>
              </div>
            </div>
          </Show>
          <Dropdown.Item
            closeOnSelect
            onSelect={() => copyShareLink(captureCurrentView())}
          >
            <LinkIcon class="size-3.5 shrink-0 text-ink-muted" />
            <span class="flex-1 truncate">Copy link to current view</span>
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/**
 * Personal display options for the Customers view: which property columns
 * show in the list and which fields show on board cards. Device-level
 * (preference-backed) — deliberately not captured by saved views.
 */
export function CompanyDisplayMenu() {
  const { options, toggleListColumn, toggleKanbanField } =
    useCrmDisplayOptions();

  return (
    <Dropdown>
      <Tooltip label="Display options">
        <Dropdown.Trigger depth={2} class="bg-surface" label="Display options">
          <SlidersIcon />
        </Dropdown.Trigger>
      </Tooltip>

      <Dropdown.Content class="w-56 shadow-menu">
        <Dropdown.Group>
          <Dropdown.GroupLabel>List columns</Dropdown.GroupLabel>
          <For each={Object.keys(CRM_LIST_COLUMN_LABELS) as CrmListColumnId[]}>
            {(column) => (
              <Dropdown.CheckboxItem
                checked={options().listColumns[column]}
                onChange={() => toggleListColumn(column)}
                closeOnSelect={false}
              >
                <span class="flex-1 truncate">
                  {CRM_LIST_COLUMN_LABELS[column]}
                </span>
              </Dropdown.CheckboxItem>
            )}
          </For>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.GroupLabel>Board card fields</Dropdown.GroupLabel>
          <For
            each={Object.keys(CRM_KANBAN_FIELD_LABELS) as CrmKanbanFieldId[]}
          >
            {(field) => (
              <Dropdown.CheckboxItem
                checked={options().kanbanFields[field]}
                onChange={() => toggleKanbanField(field)}
                closeOnSelect={false}
              >
                <span class="flex-1 truncate">
                  {CRM_KANBAN_FIELD_LABELS[field]}
                </span>
              </Dropdown.CheckboxItem>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

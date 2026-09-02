import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useApplyPreset } from '@app/features/next-soup/soup-view/soup-view-tabs';
import { useApplyCrmView } from '@app/features/next-soup/soup-view/views/companies/use-apply-crm-view';
import {
  CRM_LIST_COLUMN_LABELS,
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
import PushPinIcon from '@phosphor/push-pin.svg';
import SlidersIcon from '@phosphor/sliders-horizontal.svg';
import StackIcon from '@phosphor/stack.svg';
import TrashIcon from '@phosphor/trash.svg';
import { useIsTeamAdmin } from '@queries/team/teams';
import { Button, cn, Dropdown, SegmentedControl, Tooltip } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';

/** Copy a view's share link, with a toast either way. */
const copyShareLink = (config: CrmViewConfig) => {
  navigator.clipboard
    .writeText(buildCrmViewShareUrl(config))
    .then(() => toast.success('Link copied to clipboard'))
    .catch(() => toast.failure('Failed to copy link'));
};

/**
 * Saved-view row: the name applies the view; trailing hover actions pin it
 * as the default, copy its share link, or delete it. The pin stays visible
 * on the current default.
 */
const SavedViewRow = (props: {
  name: string;
  isDefault?: boolean;
  onApply: () => void;
  onCopyLink: () => void;
  onSetDefault?: () => void;
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
    <Show when={props.isDefault && !props.onSetDefault}>
      <PushPinIcon class="size-3.5 shrink-0 text-ink-muted" />
    </Show>
    <Show when={props.onSetDefault}>
      {(onSetDefault) => (
        <Tooltip label={props.isDefault ? 'Remove default' : 'Set as default'}>
          <Button
            variant="ghost"
            size="icon-sm"
            label={props.isDefault ? 'Remove default' : 'Set as default'}
            class={cn(
              'size-6 shrink-0 rounded-md p-1 text-ink-muted',
              !props.isDefault &&
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            )}
            onClick={() => onSetDefault()()}
          >
            <PushPinIcon class="size-3.5" />
          </Button>
        </Tooltip>
      )}
    </Show>
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
export function CompanyViewsMenu(props: { hideLabel?: boolean } = {}) {
  const {
    soup,
    queryFilters,
    searchText,
    stageFilter,
    ownerFilter,
    activeTab,
    viewMode,
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
    viewMode: viewMode(),
    stageFilter: [...stageFilter()],
    ownerFilter: [...ownerFilter()],
    activeTab: activeTab(),
  });

  const applyCrmView = useApplyCrmView();

  const applyView = (config: CrmViewConfig) => {
    applyCrmView(config);
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
      <Dropdown.Trigger
        depth={2}
        class="bg-surface"
        label={props.hideLabel ? 'Views' : undefined}
        aria-label={props.hideLabel ? 'Views' : undefined}
      >
        <StackIcon />
        <Show when={!props.hideLabel}>
          <span>Views</span>
        </Show>
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
                isDefault={view.config.isDefault === true}
                onApply={() => applyView(view.config)}
                onCopyLink={() => copyShareLink(view.config)}
                onSetDefault={() =>
                  personal.setDefault.mutate({
                    id: view.config.isDefault ? undefined : view.id,
                  })
                }
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
                isDefault={view.id === team.defaultViewId()}
                onApply={() => applyView(view.config as CrmViewConfig)}
                onCopyLink={() => copyShareLink(view.config as CrmViewConfig)}
                onSetDefault={
                  canEditCrm()
                    ? () =>
                        team.setDefault(
                          view.id === team.defaultViewId() ? undefined : view.id
                        )
                    : undefined
                }
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
                  'outline-none focus:border-accent placeholder:text-ink-placeholder'
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
                  variant="outline"
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
 * show in the list. Device-level (preference-backed) — deliberately not
 * captured by saved views. Admins/owners additionally get a toggle to view
 * the hidden-companies set (backed by the active/hidden tab presets).
 */
export function CompanyDisplayMenu() {
  const { options, toggleListColumn } = useCrmDisplayOptions();
  const { activeTab, viewMode } = useSoupView();
  const { applyTabPreset } = useApplyPreset();
  const isTeamAdmin = useIsTeamAdmin();

  const showingHidden = () => activeTab() === 'hidden';

  // On the board, the menu holds only the admin-gated hidden toggle — hide
  // the trigger entirely when there'd be nothing to show.
  const hasContent = () => viewMode() === 'list' || isTeamAdmin();

  return (
    <Show when={hasContent()}>
      <Dropdown>
        <Tooltip label="Display options">
          <Dropdown.Trigger
            depth={2}
            class="bg-surface"
            label="Display options"
          >
            <SlidersIcon />
          </Dropdown.Trigger>
        </Tooltip>

        <Dropdown.Content class="w-56 shadow-menu">
          {/* Column visibility only applies to the list. */}
          <Show when={viewMode() === 'list'}>
            <Dropdown.Group>
              <Dropdown.GroupLabel>List columns</Dropdown.GroupLabel>
              <For
                each={Object.keys(CRM_LIST_COLUMN_LABELS) as CrmListColumnId[]}
              >
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
          </Show>
          {/* Admin/owner only — the BE rejects hidden-set requests from
            non-admins, matching the old Hidden tab's gating. */}
          <Show when={isTeamAdmin()}>
            <Dropdown.Group>
              <Dropdown.CheckboxItem
                checked={showingHidden()}
                onChange={() =>
                  applyTabPreset(
                    'companies',
                    showingHidden() ? 'active' : 'hidden'
                  )
                }
                closeOnSelect={false}
              >
                <span class="flex-1 truncate">Show hidden companies</span>
              </Dropdown.CheckboxItem>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

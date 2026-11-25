import { t } from '@app/lib/i18n';
import { EntityIcon } from '@core/component/EntityIcon';
import { useContactFilterOptions } from '@core/user/use-contact-filter-options';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import UserIcon from '@icon/system/regular/user.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, cn, Dropdown, Tabs, Tooltip } from '@ui';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import {
  DRIVE_CREATOR_PRESET_ME,
  DRIVE_CREATOR_PRESET_MY_AGENTS,
  DRIVE_CREATOR_PRESET_TEAM_AGENTS,
  isDriveCreatorPreset,
} from '../../core/drive-filters';
import type { DriveShareScope } from '../../core/drive-share-provenance';
import {
  DRIVE_TYPE_FILTER_OPTIONS,
  driveModifiedFilterOptions,
  useDriveFilters,
} from '../../filters/use-drive-filters';
import { folderToProjectEntity } from '../../views/shared/use-drive-display-items';

type FilterPillProps = {
  label: string;
  activeLabel?: string;
  active: boolean;
  onClear?: () => void;
  testId?: string;
};

function FilterPillTrigger(props: FilterPillProps) {
  return (
    <div
      data-testid={props.testId}
      class={cn(
        'inline-flex h-7 max-w-52 items-center rounded-lg border text-xs transition-colors select-none',
        props.active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-edge-muted bg-surface text-ink hover:bg-hover'
      )}
    >
      <Dropdown.Trigger
        as="button"
        type="button"
        class={cn(
          'inline-flex h-full min-w-0 items-center gap-1.5 px-2.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-accent',
          props.active ? 'rounded-l-lg pr-1.5' : 'rounded-lg'
        )}
      >
        <span class="truncate">
          {props.active && props.activeLabel ? props.activeLabel : props.label}
        </span>
        <Show when={!props.active}>
          <CaretDownIcon
            class="size-3 shrink-0 text-ink-muted"
            aria-hidden="true"
          />
        </Show>
      </Dropdown.Trigger>
      <Show when={props.active && props.onClear}>
        <button
          type="button"
          aria-label={t('drive.activeFilterRemove', { label: props.label })}
          class="inline-flex h-full items-center justify-center rounded-r-lg border-l border-accent/25 px-1.5 text-accent/80 transition-colors hover:bg-accent/15 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          onClick={(event) => {
            event.stopPropagation();
            props.onClear?.();
          }}
        >
          <CloseIcon class="size-3" aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}

function PeopleFilterPill(props: {
  selectedIds: Accessor<readonly string[]>;
  activeLabel: Accessor<string | undefined>;
  isSelected: (id: string) => boolean;
  onToggle: (id: string, next: boolean) => void;
  onClear: () => void;
}) {
  const { agents } = useDriveRedesign();
  const [open, setOpen] = createSignal(false);
  const nonPresetSelectedIds = createMemo(() =>
    props.selectedIds().filter((id) => !isDriveCreatorPreset(id))
  );
  const contactSource = useContactFilterOptions(nonPresetSelectedIds, open);
  const myAgentCount = () => agents?.myAgents().length ?? 0;
  const teamAgentCount = () => agents?.teamAgents().length ?? 0;

  return (
    <Dropdown open={open()} onOpenChange={setOpen} placement="bottom-start">
      <FilterPillTrigger
        testId="drive-filter-people"
        label={t('drive.filterCreatorLabel')}
        activeLabel={props.activeLabel()}
        active={props.selectedIds().length > 0}
        onClear={props.onClear}
      />
      <Dropdown.Content class="w-64 p-1.5">
        <div class="px-2 py-1 text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">
          {t('drive.filterQuickPicks')}
        </div>
        <Dropdown.CheckboxItem
          checked={props.isSelected(DRIVE_CREATOR_PRESET_ME)}
          onChange={(checked) =>
            props.onToggle(DRIVE_CREATOR_PRESET_ME, checked)
          }
        >
          <UserIcon
            class="size-3.5 shrink-0 text-ink-muted"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate">
            {t('drive.filterCreatedByMe')}
          </span>
          <Dropdown.ItemIndicator>
            <CheckIcon class="size-3.5 text-accent" />
          </Dropdown.ItemIndicator>
        </Dropdown.CheckboxItem>
        <Dropdown.CheckboxItem
          checked={props.isSelected(DRIVE_CREATOR_PRESET_MY_AGENTS)}
          onChange={(checked) =>
            props.onToggle(DRIVE_CREATOR_PRESET_MY_AGENTS, checked)
          }
        >
          <RobotIcon
            class="size-3.5 shrink-0 text-ink-muted"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate">
            {t('drive.filterCreatedByMyAgents')}
          </span>
          <Show when={myAgentCount() > 0}>
            <span class="text-[11px] tabular-nums text-ink-subtle">
              {myAgentCount()}
            </span>
          </Show>
          <Dropdown.ItemIndicator>
            <CheckIcon class="size-3.5 text-accent" />
          </Dropdown.ItemIndicator>
        </Dropdown.CheckboxItem>
        <Show when={teamAgentCount() > myAgentCount()}>
          <Dropdown.CheckboxItem
            checked={props.isSelected(DRIVE_CREATOR_PRESET_TEAM_AGENTS)}
            onChange={(checked) =>
              props.onToggle(DRIVE_CREATOR_PRESET_TEAM_AGENTS, checked)
            }
          >
            <RobotIcon
              class="size-3.5 shrink-0 text-ink-muted"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate">
              {t('drive.filterCreatedByTeamAgents')}
            </span>
            <span class="text-[11px] tabular-nums text-ink-subtle">
              {teamAgentCount()}
            </span>
            <Dropdown.ItemIndicator>
              <CheckIcon class="size-3.5 text-accent" />
            </Dropdown.ItemIndicator>
          </Dropdown.CheckboxItem>
        </Show>

        <Dropdown.Separator />

        <div class="px-1 py-1">
          <input
            type="search"
            value={contactSource.search()}
            placeholder={t('drive.filterPeopleSearchPlaceholder')}
            aria-label={t('drive.filterPeopleSearchPlaceholder')}
            class="h-7 w-full rounded-md border border-edge-muted bg-panel px-2 text-xs text-ink outline-none placeholder:text-ink-subtle focus:border-accent"
            onInput={(event) =>
              contactSource.setSearch(event.currentTarget.value)
            }
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>

        <div class="max-h-48 overflow-y-auto">
          <For each={contactSource.options()}>
            {(option) => (
              <Dropdown.CheckboxItem
                checked={props.isSelected(option.id)}
                onChange={(checked) => props.onToggle(option.id, checked)}
              >
                <span class="min-w-0 flex-1 truncate">{option.label}</span>
                <Dropdown.ItemIndicator>
                  <CheckIcon class="size-3.5 text-accent" />
                </Dropdown.ItemIndicator>
              </Dropdown.CheckboxItem>
            )}
          </For>
          <Show
            when={
              !contactSource.loading() &&
              contactSource.options().length === 0 &&
              contactSource.search().trim().length > 0
            }
          >
            <div class="px-2 py-2 text-xs text-ink-subtle">
              {t('drive.emptySearchTitle')}
            </div>
          </Show>
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}

/**
 * Secondary desktop filter + Ask AI row directly below Drive's top header:
 * surfaces `Ask AI` beside Google-Drive-style `Type`, `People` (with Me /
 * My agents / Team agents presets), `Modified`, `Source`, and optional `Tags`
 * dropdown pills in Macro's semantic design system.
 */
export function DriveDesktopFilterBar(props: {
  typeOpen?: boolean;
  onTypeOpenChange?: (open: boolean) => void;
}) {
  const { state, sidebar } = useDriveView();
  const { host, selectedEntities } = useDriveRedesign();
  const filters = useDriveFilters();
  const [askingAi, setAskingAi] = createSignal(false);

  const activeFolder = createMemo(() => {
    const id = state.projectId();
    if (!id) return undefined;
    const found = sidebar.folders().find((folder) => folder.id === id);
    return found ? folderToProjectEntity(found) : undefined;
  });

  const handleAskAi = () => {
    if (askingAi()) return;
    setAskingAi(true);
    fireAndForget(
      (async () => {
        try {
          await host.askAi({
            selected: selectedEntities(),
            folder: activeFolder(),
            searchQuery: state.value().search,
          });
        } finally {
          setAskingAi(false);
        }
      })(),
      'drive-ask-ai'
    );
  };

  const selectedTypeIds = () => filters.selectedIds('type');
  const typeActiveLabel = () => {
    const ids = selectedTypeIds();
    if (ids.length === 0) return undefined;
    const first =
      DRIVE_TYPE_FILTER_OPTIONS.find((opt) => opt.id === ids[0])?.label ??
      ids[0];
    return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
  };

  const selectedCreatorIds = () => filters.selectedIds('created-by');
  const creatorActiveLabel = () => {
    const ids = selectedCreatorIds();
    if (ids.length === 0) return undefined;
    const first = filters.creatorLabel(ids[0]);
    return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
  };

  const selectedModifiedId = () => filters.selectedIds('modified')[0];
  const modifiedActiveLabel = () => {
    const id = selectedModifiedId();
    if (!id) return undefined;
    return driveModifiedFilterOptions().find((opt) => opt.id === id)?.label;
  };

  const scopeValue = () => state.value().scope;
  const scopeActiveLabel = () => {
    const scope = scopeValue();
    if (scope === 'all') return t('drive.filterScopeAll');
    if (scope === 'attachments') return t('drive.filterScopeAttachments');
    return undefined;
  };

  const tagOptions = () => filters.tagGroup().options;
  const selectedTagIds = () => filters.selectedIds('tags');
  const tagActiveLabel = () => {
    const ids = selectedTagIds();
    if (ids.length === 0) return undefined;
    const first =
      tagOptions().find((opt) => opt.id === ids[0])?.label ?? ids[0];
    return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
  };

  const isSharedTab = () => {
    const loc = state.value().location;
    return loc.kind === 'tab' && loc.tab === 'shared';
  };

  return (
    <div
      role="toolbar"
      aria-label={t('drive.viewOptions')}
      data-testid="drive-filter-bar"
      class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted bg-panel/45 px-4 py-2"
    >
      {/* Ask AI action pill */}
      <Tooltip label={t('drive.askAiTooltip')}>
        <button
          type="button"
          data-testid="drive-ask-ai"
          disabled={askingAi()}
          class="inline-flex h-7 items-center gap-1.5 rounded-full border border-accent/35 bg-accent/12 px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/18 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          onClick={handleAskAi}
        >
          <SparkleIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('drive.askAi')}</span>
        </button>
      </Tooltip>

      <div class="h-4 w-px shrink-0 bg-edge-muted" aria-hidden="true" />

      {/* Shared with me provenance scope switcher */}
      <Show when={isSharedTab()}>
        <Tabs<DriveShareScope>
          size="sm"
          aria-label={t('drive.sharedScopeLabel')}
          data-testid="drive-share-scope-tabs"
          value={filters.shareScope()}
          onChange={(value) => filters.setShareScope(value)}
          options={[
            { value: 'all', label: t('drive.sharedScopeAll') },
            { value: 'direct', label: t('drive.sharedScopeDirect') },
            {
              value: 'team_or_channel',
              label: t('drive.sharedScopeTeamOrChannel'),
            },
          ]}
        />
        <div class="h-4 w-px shrink-0 bg-edge-muted" aria-hidden="true" />
      </Show>

      <Show when={!filters.isRecent()}>
        {/* Type */}
        <Dropdown
          open={props.typeOpen}
          onOpenChange={props.onTypeOpenChange}
          placement="bottom-start"
        >
          <FilterPillTrigger
            testId="drive-filter-type"
            label={t('drive.filterTypeLabel')}
            activeLabel={typeActiveLabel()}
            active={selectedTypeIds().length > 0}
            onClear={() => filters.clearGroup('type')}
          />
          <Dropdown.Content class="max-h-72 min-w-48 overflow-y-auto">
            <For each={DRIVE_TYPE_FILTER_OPTIONS}>
              {(option) => (
                <Dropdown.CheckboxItem
                  checked={filters.isSelected('type', option.id)}
                  onChange={(checked) =>
                    filters.setSelected('type', option.id, checked)
                  }
                >
                  <EntityIcon targetType={option.type} size="xs" />
                  <span class="min-w-0 flex-1 truncate">{option.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.CheckboxItem>
              )}
            </For>
          </Dropdown.Content>
        </Dropdown>

        {/* People (Me / My agents / Team agents / Contact search) */}
        <PeopleFilterPill
          selectedIds={selectedCreatorIds}
          activeLabel={creatorActiveLabel}
          isSelected={(id) => filters.isSelected('created-by', id)}
          onToggle={(id, checked) =>
            filters.setSelected('created-by', id, checked)
          }
          onClear={() => filters.clearGroup('created-by')}
        />

        {/* Modified */}
        <Dropdown placement="bottom-start">
          <FilterPillTrigger
            testId="drive-filter-modified"
            label={t('drive.filterModifiedLabel')}
            activeLabel={modifiedActiveLabel()}
            active={Boolean(selectedModifiedId())}
            onClear={() => filters.clearGroup('modified')}
          />
          <Dropdown.Content class="min-w-44">
            <Dropdown.RadioGroup
              value={selectedModifiedId() ?? ''}
              onChange={(value) => {
                if (value === selectedModifiedId()) {
                  filters.clearGroup('modified');
                } else {
                  filters.setSelected('modified', value, true);
                }
              }}
            >
              <For each={driveModifiedFilterOptions()}>
                {(option) => (
                  <Dropdown.RadioItem value={option.id} closeOnSelect>
                    <span class="flex-1">{option.label}</span>
                    <Dropdown.ItemIndicator>
                      <CheckIcon class="size-3.5 text-accent" />
                    </Dropdown.ItemIndicator>
                  </Dropdown.RadioItem>
                )}
              </For>
            </Dropdown.RadioGroup>
          </Dropdown.Content>
        </Dropdown>
      </Show>

      {/* Source (Drive files / All files / Email attachments) */}
      <Dropdown placement="bottom-start">
        <FilterPillTrigger
          testId="drive-filter-source"
          label={t('drive.filterSourceLabel')}
          activeLabel={scopeActiveLabel()}
          active={scopeValue() !== 'default'}
          onClear={() => filters.clearGroup('scope')}
        />
        <Dropdown.Content class="min-w-48">
          <Dropdown.RadioGroup
            value={scopeValue()}
            onChange={(value) => filters.setSelected('scope', value, true)}
          >
            <Dropdown.RadioItem value="default" closeOnSelect>
              <span class="flex-1">{t('drive.filterSourceDefault')}</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
            <Dropdown.RadioItem value="all" closeOnSelect>
              <span class="flex-1">{t('drive.filterScopeAll')}</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
            <Dropdown.RadioItem value="attachments" closeOnSelect>
              <span class="flex-1">{t('drive.filterScopeAttachments')}</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-3.5 text-accent" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown>

      {/* Tags (only when the user has tags defined) */}
      <Show when={!filters.isRecent() && tagOptions().length > 0}>
        <Dropdown placement="bottom-start">
          <FilterPillTrigger
            testId="drive-filter-tags"
            label={t('drive.filterTagsLabel')}
            activeLabel={tagActiveLabel()}
            active={selectedTagIds().length > 0}
            onClear={() => filters.clearGroup('tags')}
          />
          <Dropdown.Content class="max-h-64 min-w-44 overflow-y-auto">
            <For each={tagOptions()}>
              {(option) => (
                <Dropdown.CheckboxItem
                  checked={filters.isSelected('tags', option.id)}
                  onChange={(checked) =>
                    filters.setSelected('tags', option.id, checked)
                  }
                >
                  <span class="min-w-0 flex-1 truncate">{option.label}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.CheckboxItem>
              )}
            </For>
          </Dropdown.Content>
        </Dropdown>
      </Show>

      <Show when={filters.activeCount() > 0}>
        <Button
          variant="ghost"
          size="xs"
          class="text-xs text-ink-muted hover:text-ink"
          onClick={filters.clear}
        >
          {t('drive.clearAllFilters')}
        </Button>
      </Show>
    </div>
  );
}

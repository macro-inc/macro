import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { EntityIcon } from '@core/component/EntityIcon';
import { useContactFilterOptions } from '@core/user/use-contact-filter-options';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import UserIcon from '@icon/system/regular/user.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { cn } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import {
  DRIVE_CREATOR_PRESET_ME,
  DRIVE_CREATOR_PRESET_MY_AGENTS,
  DRIVE_CREATOR_PRESET_TEAM_AGENTS,
  isDriveCreatorPreset,
} from '../../core/drive-filters';
import {
  DRIVE_TYPE_FILTER_OPTIONS,
  driveModifiedFilterOptions,
  useDriveFilters,
} from '../../filters/use-drive-filters';
import { folderToProjectEntity } from '../shared/use-drive-display-items';

type ActiveMobileFilterSheet = 'type' | 'created-by' | 'modified' | 'scope';

/**
 * Compact horizontally-scrollable pill strip beneath the mobile Drive header:
 * surfaces `Ask AI`, `Type`, `People`, `Modified`, and `Source` with native
 * touch bottom sheets for picking values.
 */
export function DriveMobileFilterStrip() {
  const { state, sidebar } = useDriveView();
  const { host, agents } = useDriveRedesign();
  const filters = useDriveFilters();
  const [sheet, setSheet] = createSignal<ActiveMobileFilterSheet | undefined>();
  const [askingAi, setAskingAi] = createSignal(false);

  const activeFolder = createMemo(() => {
    const id = state.projectId();
    if (!id) return undefined;
    const found = sidebar.folders().find((folder) => folder.id === id);
    return found ? folderToProjectEntity(found) : undefined;
  });

  const selectedTypeIds = () => filters.selectedIds('type');
  const typeLabel = () => {
    const ids = selectedTypeIds();
    if (ids.length === 0) return t('drive.filterTypeLabel');
    const first =
      DRIVE_TYPE_FILTER_OPTIONS.find((opt) => opt.id === ids[0])?.label ??
      ids[0];
    return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
  };

  const selectedCreatorIds = () => filters.selectedIds('created-by');
  const nonPresetCreatorIds = createMemo(() =>
    selectedCreatorIds().filter((id) => !isDriveCreatorPreset(id))
  );
  const peopleLabel = () => {
    const ids = selectedCreatorIds();
    if (ids.length === 0) return t('drive.filterCreatorLabel');
    const first = filters.creatorLabel(ids[0]);
    return ids.length === 1 ? first : `${first} +${ids.length - 1}`;
  };

  const selectedModifiedId = () => filters.selectedIds('modified')[0];
  const modifiedLabel = () => {
    const id = selectedModifiedId();
    if (!id) return t('drive.filterModifiedLabel');
    return (
      driveModifiedFilterOptions().find((opt) => opt.id === id)?.label ??
      t('drive.filterModifiedLabel')
    );
  };

  const scopeValue = () => state.value().scope;
  const sourceLabel = () => {
    if (scopeValue() === 'all') return t('drive.filterScopeAll');
    if (scopeValue() === 'attachments')
      return t('drive.filterScopeAttachments');
    return t('drive.filterSourceLabel');
  };

  const handleAskAi = () => {
    if (askingAi()) return;
    setAskingAi(true);
    fireAndForget(
      (async () => {
        try {
          await host.askAi({
            folder: activeFolder(),
            searchQuery: state.value().search,
          });
        } finally {
          setAskingAi(false);
        }
      })(),
      'drive-mobile-ask-ai'
    );
  };

  const myAgentCount = () => agents?.myAgents().length ?? 0;
  const teamAgentCount = () => agents?.teamAgents().length ?? 0;

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('drive.viewOptions')}
        data-testid="drive-mobile-filter-strip"
        class="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]"
      >
        <button
          type="button"
          data-testid="drive-mobile-ask-ai"
          disabled={askingAi()}
          class="island inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-accent/35 bg-accent/14 px-3 text-xs font-semibold text-accent disabled:opacity-50"
          onClick={handleAskAi}
        >
          <SparkleIcon class="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('drive.askAi')}</span>
        </button>

        <Show when={!filters.isRecent()}>
          <MobilePillButton
            testId="drive-mobile-pill-type"
            label={typeLabel()}
            active={selectedTypeIds().length > 0}
            onOpen={() => setSheet('type')}
            onClear={() => filters.clearGroup('type')}
          />
          <MobilePillButton
            testId="drive-mobile-pill-people"
            label={peopleLabel()}
            active={selectedCreatorIds().length > 0}
            onOpen={() => setSheet('created-by')}
            onClear={() => filters.clearGroup('created-by')}
          />
          <MobilePillButton
            testId="drive-mobile-pill-modified"
            label={modifiedLabel()}
            active={Boolean(selectedModifiedId())}
            onOpen={() => setSheet('modified')}
            onClear={() => filters.clearGroup('modified')}
          />
        </Show>

        <MobilePillButton
          testId="drive-mobile-pill-source"
          label={sourceLabel()}
          active={scopeValue() !== 'default'}
          onOpen={() => setSheet('scope')}
          onClear={() => filters.clearGroup('scope')}
        />
      </div>

      <MobileDrawer
        side="bottom"
        open={Boolean(sheet())}
        onOpenChange={(open) => {
          if (!open) setSheet(undefined);
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content
            aria-label={
              sheet() === 'type'
                ? t('drive.filterTypeLabel')
                : sheet() === 'created-by'
                  ? t('drive.filterCreatorLabel')
                  : sheet() === 'modified'
                    ? t('drive.filterModifiedLabel')
                    : t('drive.filterSourceLabel')
            }
          >
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody class="gap-2 px-1">
              <Switch>
                <Match when={sheet() === 'type'}>
                  <MobileDrawer.Label>
                    {t('drive.filterTypeLabel')}
                  </MobileDrawer.Label>
                  <MobileDrawer.Section>
                    <For each={DRIVE_TYPE_FILTER_OPTIONS}>
                      {(option) => (
                        <MobileFilterDrawer.Option
                          selectionMode="multiple"
                          checked={filters.isSelected('type', option.id)}
                          onChange={(checked) =>
                            filters.setSelected('type', option.id, checked)
                          }
                          icon={
                            <EntityIcon targetType={option.type} size="xs" />
                          }
                        >
                          {option.label}
                        </MobileFilterDrawer.Option>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </Match>

                <Match when={sheet() === 'created-by'}>
                  <MobileDrawer.Label>
                    {t('drive.filterQuickPicks')}
                  </MobileDrawer.Label>
                  <MobileDrawer.Section>
                    <MobileFilterDrawer.Option
                      selectionMode="multiple"
                      checked={filters.isSelected(
                        'created-by',
                        DRIVE_CREATOR_PRESET_ME
                      )}
                      onChange={(checked) =>
                        filters.setSelected(
                          'created-by',
                          DRIVE_CREATOR_PRESET_ME,
                          checked
                        )
                      }
                      icon={<UserIcon class="size-4 text-ink-muted" />}
                    >
                      {t('drive.filterCreatedByMe')}
                    </MobileFilterDrawer.Option>
                    <MobileFilterDrawer.Option
                      selectionMode="multiple"
                      checked={filters.isSelected(
                        'created-by',
                        DRIVE_CREATOR_PRESET_MY_AGENTS
                      )}
                      onChange={(checked) =>
                        filters.setSelected(
                          'created-by',
                          DRIVE_CREATOR_PRESET_MY_AGENTS,
                          checked
                        )
                      }
                      icon={<RobotIcon class="size-4 text-ink-muted" />}
                    >
                      {t('drive.filterCreatedByMyAgents')}
                      {myAgentCount() > 0 ? ` (${myAgentCount()})` : ''}
                    </MobileFilterDrawer.Option>
                    <Show when={teamAgentCount() > myAgentCount()}>
                      <MobileFilterDrawer.Option
                        selectionMode="multiple"
                        checked={filters.isSelected(
                          'created-by',
                          DRIVE_CREATOR_PRESET_TEAM_AGENTS
                        )}
                        onChange={(checked) =>
                          filters.setSelected(
                            'created-by',
                            DRIVE_CREATOR_PRESET_TEAM_AGENTS,
                            checked
                          )
                        }
                        icon={<RobotIcon class="size-4 text-ink-muted" />}
                      >
                        {t('drive.filterCreatedByTeamAgents')} (
                        {teamAgentCount()})
                      </MobileFilterDrawer.Option>
                    </Show>
                  </MobileDrawer.Section>
                  <MobileDrawer.Label class="pt-3">
                    {t('drive.filterCreatorLabel')}
                  </MobileDrawer.Label>
                  <MobileFilterDrawer.SourceOptions
                    groupId="created-by"
                    createSource={useContactFilterOptions}
                    enabled={() => sheet() === 'created-by'}
                    activeIds={nonPresetCreatorIds}
                    placeholder={t('drive.filterPeopleSearchPlaceholder')}
                    onChange={(id, checked) =>
                      filters.setSelected('created-by', id, checked)
                    }
                  />
                </Match>

                <Match when={sheet() === 'modified'}>
                  <MobileDrawer.Label>
                    {t('drive.filterModifiedLabel')}
                  </MobileDrawer.Label>
                  <MobileDrawer.Section>
                    <For each={driveModifiedFilterOptions()}>
                      {(option) => (
                        <MobileFilterDrawer.Option
                          selectionMode="single"
                          checked={selectedModifiedId() === option.id}
                          onChange={(checked) => {
                            filters.setSelected('modified', option.id, checked);
                            setSheet(undefined);
                          }}
                        >
                          {option.label}
                        </MobileFilterDrawer.Option>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </Match>

                <Match when={sheet() === 'scope'}>
                  <MobileDrawer.Label>
                    {t('drive.filterSourceLabel')}
                  </MobileDrawer.Label>
                  <MobileDrawer.Section>
                    <MobileFilterDrawer.Option
                      selectionMode="single"
                      checked={scopeValue() === 'default'}
                      onChange={() => {
                        filters.setSelected('scope', 'default', true);
                        setSheet(undefined);
                      }}
                    >
                      {t('drive.filterSourceDefault')}
                    </MobileFilterDrawer.Option>
                    <MobileFilterDrawer.Option
                      selectionMode="single"
                      checked={scopeValue() === 'all'}
                      onChange={() => {
                        filters.setSelected('scope', 'all', true);
                        setSheet(undefined);
                      }}
                    >
                      {t('drive.filterScopeAll')}
                    </MobileFilterDrawer.Option>
                    <MobileFilterDrawer.Option
                      selectionMode="single"
                      checked={scopeValue() === 'attachments'}
                      onChange={() => {
                        filters.setSelected('scope', 'attachments', true);
                        setSheet(undefined);
                      }}
                    >
                      {t('drive.filterScopeAttachments')}
                    </MobileFilterDrawer.Option>
                  </MobileDrawer.Section>
                </Match>
              </Switch>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </>
  );
}

function MobilePillButton(props: {
  label: string;
  active: boolean;
  testId?: string;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <div
      data-testid={props.testId}
      class={cn(
        'island inline-flex h-8 shrink-0 items-center rounded-full text-xs',
        props.active
          ? 'border border-accent/40 bg-accent/14 text-accent'
          : 'bg-chrome text-ink'
      )}
    >
      <button
        type="button"
        class={cn(
          'inline-flex h-full items-center gap-1 px-2.5 font-medium',
          props.active && 'pr-1.5'
        )}
        onClick={props.onOpen}
      >
        <span class="max-w-32 truncate">{props.label}</span>
        <Show when={!props.active}>
          <CaretDownIcon class="size-3 text-ink-muted" aria-hidden="true" />
        </Show>
      </button>
      <Show when={props.active}>
        <button
          type="button"
          aria-label={t('drive.activeFilterRemove', { label: props.label })}
          class="inline-flex h-full items-center justify-center rounded-r-full border-l border-accent/25 px-1.5 text-accent"
          onClick={(event) => {
            event.stopPropagation();
            props.onClear();
          }}
        >
          <CloseIcon class="size-3" aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}

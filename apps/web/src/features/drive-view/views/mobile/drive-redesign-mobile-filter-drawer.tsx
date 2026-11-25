import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Accordion } from '@kobalte/core/accordion';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { useDriveView } from '../../context/drive-context';
import { useDriveRedesign } from '../../context/drive-redesign-context';
import { DRIVE_SORT_OPTIONS } from '../../core/types';
import { useDriveFilters } from '../../filters/use-drive-filters';

/**
 * Touch Sort + Filter drawer that works across every Drive view, including
 * inside folders (fixing the legacy gap where filters disappeared in folders).
 * Also exposes Sort direction and Folders first preferences.
 */
export function DriveRedesignMobileFilterDrawer() {
  const { state } = useDriveView();
  const { preferences } = useDriveRedesign();
  const filters = useDriveFilters();
  const [open, setOpen] = createSignal(false);

  const isRecent = () => {
    const loc = state.value().location;
    return loc.kind === 'tab' && loc.tab === 'recent';
  };

  return (
    <MobileFilterDrawer
      open={open()}
      onOpenChange={setOpen}
      triggerLabel="Open file filters"
      label="Sort & Filter"
      activeCount={filters.activeCount()}
      onClear={filters.clear}
    >
      <Show when={!isRecent()}>
        <MobileDrawer.Label id="drive-mobile-sort-label" class="pt-3">
          {t('drive.sortBy')}
        </MobileDrawer.Label>
        <MobileDrawer.Section
          role="radiogroup"
          aria-labelledby="drive-mobile-sort-label"
        >
          <For each={DRIVE_SORT_OPTIONS}>
            {(option) => (
              <MobileFilterDrawer.Option
                selectionMode="single"
                checked={state.value().sort === option.id}
                onChange={() => {
                  state.setSort(option.id);
                  preferences.setSortDirection(
                    option.id === 'name' ? 'asc' : 'desc'
                  );
                }}
              >
                {option.label}
              </MobileFilterDrawer.Option>
            )}
          </For>
        </MobileDrawer.Section>

        <MobileDrawer.Label class="pt-4">
          {t('drive.displayOptions')}
        </MobileDrawer.Label>
        <MobileDrawer.Section>
          <MobileFilterDrawer.Option
            selectionMode="multiple"
            checked={preferences.foldersFirst()}
            onChange={() => preferences.toggleFoldersFirst()}
          >
            {t('drive.foldersFirst')}
          </MobileFilterDrawer.Option>
          <MobileFilterDrawer.Option
            selectionMode="single"
            checked={preferences.sortDirection() === 'asc'}
            onChange={() => preferences.setSortDirection('asc')}
          >
            {t('drive.sortDirectionAsc')}
          </MobileFilterDrawer.Option>
          <MobileFilterDrawer.Option
            selectionMode="single"
            checked={preferences.sortDirection() === 'desc'}
            onChange={() => preferences.setSortDirection('desc')}
          >
            {t('drive.sortDirectionDesc')}
          </MobileFilterDrawer.Option>
        </MobileDrawer.Section>
      </Show>

      <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
      <Accordion
        multiple
        collapsible
        defaultValue={[filters.groups()[0]?.id ?? 'type']}
      >
        <div class="flex flex-col gap-3">
          <For each={filters.groups()}>
            {(group) => {
              const activeCount = createMemo(
                () =>
                  filters
                    .selectedIds(group.id)
                    .filter((id) => id !== group.defaultOptionId).length
              );

              return (
                <MobileFilterDrawer.Section
                  value={group.id}
                  label={group.label}
                  activeCount={activeCount()}
                >
                  <Show
                    when={group.createSource}
                    fallback={
                      <For each={group.options}>
                        {(option) => (
                          <MobileFilterDrawer.Option
                            selectionMode={group.selectionMode}
                            checked={filters.isSelected(group.id, option.id)}
                            onChange={(checked) =>
                              filters.setSelected(group.id, option.id, checked)
                            }
                            icon={option.icon?.()}
                          >
                            {option.label}
                          </MobileFilterDrawer.Option>
                        )}
                      </For>
                    }
                  >
                    {(createSource) => (
                      <MobileFilterDrawer.SourceOptions
                        groupId={group.id}
                        createSource={createSource()}
                        enabled={open}
                        activeIds={() => filters.selectedIds(group.id)}
                        placeholder={group.searchPlaceholder}
                        onChange={(id, checked) =>
                          filters.setSelected(group.id, id, checked)
                        }
                      />
                    )}
                  </Show>
                </MobileFilterDrawer.Section>
              );
            }}
          </For>
        </div>
      </Accordion>
    </MobileFilterDrawer>
  );
}

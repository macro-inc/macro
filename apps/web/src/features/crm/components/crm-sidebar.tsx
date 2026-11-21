import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { SidebarRoutineSuggestions } from '@app/features/routine-suggestions/routine-suggestions';
import { t } from '@app/lib/i18n';
import { getIconConfig } from '@core/component/EntityIcon';
import BuildingsIcon from '@icon/system/regular/buildings.svg';
import ExportIcon from '@icon/system/regular/download-simple.svg';
import GearIcon from '@icon/system/regular/gear-six.svg';
import ListIcon from '@icon/system/regular/list-bullets.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import ImportIcon from '@icon/system/regular/upload-simple.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CRM_ACTIVITY_TABS, CRM_RECORDS } from '../core/navigation';
import { COMPANIES_TOUR } from '../tour';
import { CrmCreateMenu } from './crm-create-menu';

const RECORD_ICONS = {
  active: BuildingsIcon,
  people: UsersIcon,
  tasks: getIconConfig('task').icon,
  email: getIconConfig('email').icon,
  notes: getIconConfig('md').icon,
  calls: getIconConfig('call').icon,
};

export function CrmSidebar(props: {
  /** The highlighted record type, list, pipeline, or `settings`. */
  active: string;
  /** Keep destinations visible until access is proven denied. */
  canAccess: boolean;
  pipelines?: JSX.Element;
  /** Pinned to the bottom of the scrolling content, above the tools. */
  promotion?: JSX.Element;
  lists: { id: string; name: string; count: number }[];
  listsEnabled: boolean;
  listsLoading: boolean;
  listsError: boolean;
  canCreateList: boolean;
  onNavigate: (id: string) => void;
  onCreateCompany: () => void;
  onCreateContact: () => void;
  /** Pipeline creation, omitted while pipelines are unavailable. */
  pipeline?: { disabled: boolean; onCreate(): void };
  onNewList: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
}) {
  const [recordsOpen, setRecordsOpen] = createSignal(true);
  const [listsOpen, setListsOpen] = createSignal(true);
  return (
    <ViewSidebar.Root reorderId="crm" aria-label={t('crm.navigation')}>
      <header class="flex shrink-0 flex-col">
        <ViewSidebar.Header>
          <div class="flex min-w-0 items-center gap-1">
            <ViewSidebar.CloseButton class="shrink-0" />
            <ViewSidebar.Title>{t('nav.customers')}</ViewSidebar.Title>
          </div>
        </ViewSidebar.Header>
        <Show when={props.canAccess}>
          <ViewSidebar.Primary ref={tourTarget(COMPANIES_TOUR.create)}>
            <CrmCreateMenu
              onCreateCompany={props.onCreateCompany}
              onCreateContact={props.onCreateContact}
              pipeline={props.pipeline}
            />
          </ViewSidebar.Primary>
        </Show>
      </header>
      <ViewSidebar.Content>
        <Show when={props.canAccess}>
          <SidebarRoutineSuggestions surface="crm" />
          <CollapsibleSection.Root
            sectionId="records"
            sectionLabel={t('crm.records')}
            open={recordsOpen()}
            onOpenChange={setRecordsOpen}
          >
            <CollapsibleSection.Header>
              <CollapsibleSection.Trigger>
                <span>{t('crm.records')}</span>
                <CollapsibleSection.Indicator />
              </CollapsibleSection.Trigger>
            </CollapsibleSection.Header>
            <CollapsibleSection.Content>
              <ViewSidebar.Nav
                aria-label={t('crm.recordsNavigation')}
                ref={tourTarget(COMPANIES_TOUR.records)}
              >
                <For each={[...CRM_RECORDS, ...CRM_ACTIVITY_TABS]}>
                  {(record) => (
                    <ViewSidebar.Item
                      active={props.active === record.id}
                      onClick={() => props.onNavigate(record.id)}
                    >
                      <ViewSidebar.Icon>
                        <Dynamic
                          component={RECORD_ICONS[record.id]}
                          class="size-4"
                        />
                      </ViewSidebar.Icon>
                      <span class="truncate">{record.label}</span>
                    </ViewSidebar.Item>
                  )}
                </For>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </Show>
        {props.pipelines}
        <Show when={props.canAccess && props.listsEnabled}>
          <CollapsibleSection.Root
            sectionId="lists"
            sectionLabel={t('crm.lists')}
            open={listsOpen()}
            onOpenChange={setListsOpen}
          >
            <CollapsibleSection.Header>
              <CollapsibleSection.Trigger>
                <span>{t('crm.lists')}</span>
                <CollapsibleSection.Indicator />
              </CollapsibleSection.Trigger>
            </CollapsibleSection.Header>
            <CollapsibleSection.Content>
              <ViewSidebar.Nav aria-label={t('crm.listsNavigation')}>
                <For each={props.lists}>
                  {(list) => (
                    <ViewSidebar.Item
                      active={props.active === `list:${list.id}`}
                      title={list.name}
                      onClick={() => props.onNavigate(`list:${list.id}`)}
                    >
                      <ViewSidebar.Icon>
                        <ListIcon class="size-4" />
                      </ViewSidebar.Icon>
                      <span class="min-w-0 flex-1 truncate">{list.name}</span>
                      <span class="text-xs tabular-nums text-ink-extra-muted">
                        {list.count}
                      </span>
                    </ViewSidebar.Item>
                  )}
                </For>
                <Show when={!props.lists.length}>
                  <p class="px-3 pb-2 text-xs leading-5 text-ink-extra-muted">
                    {props.listsLoading
                      ? 'Loading lists…'
                      : props.listsError
                        ? 'Could not load lists.'
                        : 'Your own collections of companies.'}
                  </p>
                </Show>
                <ViewSidebar.Item
                  onClick={props.onNewList}
                  disabled={!props.canCreateList}
                >
                  <ViewSidebar.Icon>
                    <PlusIcon class="size-4" />
                  </ViewSidebar.Icon>
                  <span>{t('crm.newList')}</span>
                </ViewSidebar.Item>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </Show>
        <Show when={props.canAccess}>{props.promotion}</Show>
      </ViewSidebar.Content>
      <Show when={props.canAccess}>
        <ViewSidebar.Footer>
          <ViewSidebar.Nav aria-label={t('crm.toolsNavigation')}>
            <ViewSidebar.Item
              onClick={props.onImport}
              disabled={!props.canCreateList}
            >
              <ViewSidebar.Icon>
                <ImportIcon class="size-4" />
              </ViewSidebar.Icon>
              {t('crm.import')}
            </ViewSidebar.Item>
            <ViewSidebar.Item
              onClick={props.onExport}
              disabled={!props.canCreateList}
            >
              <ViewSidebar.Icon>
                <ExportIcon class="size-4" />
              </ViewSidebar.Icon>
              {t('crm.export')}
            </ViewSidebar.Item>
            <ViewSidebar.Item
              active={props.active === 'settings'}
              aria-label={t('crm.settingsLabel')}
              onClick={props.onSettings}
            >
              <ViewSidebar.Icon>
                <GearIcon class="size-4" />
              </ViewSidebar.Icon>
              {t('crm.settings')}
            </ViewSidebar.Item>
          </ViewSidebar.Nav>
        </ViewSidebar.Footer>
      </Show>
    </ViewSidebar.Root>
  );
}

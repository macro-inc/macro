import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
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
import { CRM_RECORDS } from '../core/navigation';
import { COMPANIES_TOUR } from '../tour';
import { CrmCreateMenu } from './crm-create-menu';

const RECORD_ICONS = { active: BuildingsIcon, people: UsersIcon };

export function CrmSidebar(props: {
  /** The highlighted record type, list, or pipeline. */
  active: string;
  actions?: JSX.Element;
  pipelines?: JSX.Element;
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
  onCollapse: () => void;
}) {
  const [recordsOpen, setRecordsOpen] = createSignal(true);
  const [listsOpen, setListsOpen] = createSignal(true);
  return (
    <ViewSidebar.Root aria-label="CRM navigation">
      <header class="flex shrink-0 flex-col">
        <Show when={isTouchDevice() && !props.actions}>
          <ViewSidebar.Primary ref={tourTarget(COMPANIES_TOUR.create)}>
            <CrmCreateMenu
              onCreateCompany={props.onCreateCompany}
              onCreateContact={props.onCreateContact}
              pipeline={props.pipeline}
            />
          </ViewSidebar.Primary>
        </Show>
      </header>
      {props.actions}
      <ViewSidebar.Content>
        <CollapsibleSection.Root
          open={recordsOpen()}
          onOpenChange={setRecordsOpen}
        >
          <CollapsibleSection.Trigger>
            <span>Records</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav
              aria-label="CRM records"
              ref={tourTarget(COMPANIES_TOUR.records)}
            >
              <For each={CRM_RECORDS}>
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
        {props.pipelines}
        <Show when={props.listsEnabled}>
          <CollapsibleSection.Root
            open={listsOpen()}
            onOpenChange={setListsOpen}
          >
            <CollapsibleSection.Trigger>
              <span>Lists</span>
              <CollapsibleSection.Indicator />
            </CollapsibleSection.Trigger>
            <CollapsibleSection.Content>
              <ViewSidebar.Nav aria-label="Company lists">
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
                  <span>New list</span>
                </ViewSidebar.Item>
              </ViewSidebar.Nav>
            </CollapsibleSection.Content>
          </CollapsibleSection.Root>
        </Show>
      </ViewSidebar.Content>
      <ViewSidebar.Footer>
        <ViewSidebar.Nav aria-label="CRM tools">
          <ViewSidebar.Item
            onClick={props.onImport}
            disabled={!props.canCreateList}
          >
            <ViewSidebar.Icon>
              <ImportIcon class="size-4" />
            </ViewSidebar.Icon>
            Import
          </ViewSidebar.Item>
          <ViewSidebar.Item
            onClick={props.onExport}
            disabled={!props.canCreateList}
          >
            <ViewSidebar.Icon>
              <ExportIcon class="size-4" />
            </ViewSidebar.Icon>
            Export
          </ViewSidebar.Item>
          <ViewSidebar.Item onClick={props.onSettings}>
            <ViewSidebar.Icon>
              <GearIcon class="size-4" />
            </ViewSidebar.Icon>
            CRM settings
          </ViewSidebar.Item>
        </ViewSidebar.Nav>
      </ViewSidebar.Footer>
    </ViewSidebar.Root>
  );
}

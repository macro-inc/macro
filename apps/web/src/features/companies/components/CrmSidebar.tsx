import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { TabsInset } from '@core/component/TabsInset';
import ExportIcon from '@phosphor/download-simple.svg';
import GearIcon from '@phosphor/gear-six.svg';
import ListIcon from '@phosphor/list-bullets.svg';
import PlusIcon from '@phosphor/plus.svg';
import SidebarIcon from '@phosphor/sidebar-simple.svg';
import StackIcon from '@phosphor/stack.svg';
import ImportIcon from '@phosphor/upload-simple.svg';
import { Button, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { CRM_VIEWS } from '../core/crm-navigation';

export function CrmSidebar(props: {
  active: string;
  viewMode: 'board' | 'list';
  onViewModeChange: (mode: 'board' | 'list') => void;
  lists: { id: string; name: string; count: number }[];
  savedViews: { id: string; name: string }[];
  listsEnabled: boolean;
  listsLoading: boolean;
  listsError: boolean;
  canCreateList: boolean;
  onNavigate: (id: string) => void;
  onCreate: () => void;
  onNewList: () => void;
  onImport: () => void;
  onExport: () => void;
  onSettings: () => void;
  onCollapse: () => void;
}) {
  const [viewsOpen, setViewsOpen] = createSignal(true);
  const [listsOpen, setListsOpen] = createSignal(true);
  return (
    <ViewSidebar.Root aria-label="CRM navigation">
      <SidebarCreateHeader
        title="Customers"
        label="New company"
        onCreate={props.onCreate}
        actions={
          <Tooltip label="Collapse CRM sidebar">
            <Button
              variant="ghost"
              size="icon-sm"
              label="Collapse CRM sidebar"
              onClick={props.onCollapse}
            >
              <SidebarIcon class="size-4" />
            </Button>
          </Tooltip>
        }
      />
      <ViewSidebar.Content>
        <div class="px-1.5">
          <TabsInset
            aria-label="Company layout"
            fullWidth
            class="h-auto"
            labelClass="py-1.5"
            list={[
              { value: 'board', label: 'Board' },
              { value: 'list', label: 'List' },
            ]}
            value={props.viewMode}
            onChange={(mode) =>
              props.onViewModeChange(mode === 'board' ? 'board' : 'list')
            }
          />
        </div>
        <CollapsibleSection.Root open={viewsOpen()} onOpenChange={setViewsOpen}>
          <CollapsibleSection.Trigger>
            <span>Views</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
          <CollapsibleSection.Content>
            <ViewSidebar.Nav aria-label="Company views">
              <For each={CRM_VIEWS}>
                {(view) => (
                  <Tooltip label={view.description} placement="right">
                    <ViewSidebar.Item
                      active={props.active === view.id}
                      onClick={() => props.onNavigate(view.id)}
                    >
                      <ViewSidebar.Icon />
                      <span class="truncate">{view.label}</span>
                    </ViewSidebar.Item>
                  </Tooltip>
                )}
              </For>
              <For each={props.savedViews}>
                {(view) => (
                  <ViewSidebar.Item
                    active={props.active === view.id}
                    title={view.name}
                    onClick={() => props.onNavigate(view.id)}
                  >
                    <ViewSidebar.Icon>
                      <StackIcon class="size-4" />
                    </ViewSidebar.Icon>
                    <span class="truncate">{view.name}</span>
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
          </CollapsibleSection.Content>
        </CollapsibleSection.Root>
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

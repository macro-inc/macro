import { t } from '@app/lib/i18n';
import { TabSelector } from '@ui';
import { createSignal, For, type JSX } from 'solid-js';
import type { Widget, WidgetOf } from '../view';
import { DashboardsOnly } from './panes/pane';

export type TabsProps = Omit<WidgetOf<'tabs'>, 'type'> & {
  /** Draws one child; the renderer passes its own dispatch. */
  render: (child: Widget) => JSX.Element;
};

/**
 * Named pages, one shown at a time. Only the open page mounts, so a hidden
 * page's panes never query. On touch the tab row is the segmented track
 * `TabSelector` draws there.
 */
export function Tabs(props: TabsProps) {
  // Pages are named by position: two pages may share a label.
  const [page, setPage] = createSignal(0);
  // A view re-presented with fewer pages keeps a page open.
  const open = () => String(Math.min(page(), props.tabs.length - 1));
  return (
    <DashboardsOnly>
      <TabSelector.Root
        value={open()}
        onChange={(value) => setPage(Number(value))}
        class="flex w-full min-w-0 flex-col gap-3"
      >
        <TabSelector>
          <TabSelector.List aria-label={t('dynamicUi.tabs')}>
            <For each={props.tabs}>
              {(tab, index) => (
                <TabSelector.Tab value={String(index())}>
                  {tab.label}
                </TabSelector.Tab>
              )}
            </For>
          </TabSelector.List>
        </TabSelector>
        <For each={props.tabs}>
          {(tab, index) => (
            <TabSelector.Panel
              value={String(index())}
              class="flex min-w-0 flex-col gap-3"
            >
              <For each={tab.children}>{(child) => props.render(child)}</For>
            </TabSelector.Panel>
          )}
        </For>
      </TabSelector.Root>
    </DashboardsOnly>
  );
}

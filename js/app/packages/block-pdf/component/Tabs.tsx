import {
  useCurrentPageNumber,
  viewerHasVisiblePagesSignal,
} from '@block-pdf/signal/pdfViewer';
import {
  activeTabIdSignal,
  MAX_TAB_COUNT,
  tabDataStore,
  useCreateTab,
  useDeleteTab,
  useNavigateToTab,
} from '@block-pdf/signal/tab';
import PlusIcon from '@icon/bold/plus-bold.svg';
import XIcon from '@icon/bold/x-bold.svg';
import { For, Show } from 'solid-js';

interface IInternalTabProps {
  label: string;
  location: string;
  index: number;
  id: number;
  tabCount: number;
  clickHandler: () => void;
  deleteTab: () => void;
}

function Tab(props: IInternalTabProps) {
  const [activeTabId] = activeTabIdSignal;
  const currentPageNumber = useCurrentPageNumber();

  const active = () => props.id === activeTabId();

  // TODO (seamus) Tab label should be able to pull information from pdf
  // section data.
  const label = () => (active() ? `Page ${currentPageNumber()}` : props.label);

  return (
    <div
      class="border flex justify-between items-center px-2 py-0.5 border-edge rounded-lg mr-1 shrink hover:bg-hover hover-transition-bg"
      classList={{ 'bg-active': active() }}
      onClick={props.clickHandler}
    >
      <span class="truncate text-sm font-medium">{label()}</span>
      <Show when={props.tabCount > 1}>
        <XIcon
          width={16}
          height={16}
          class="text-ink-muted shrink-0 ml-3 hover:bg-hover hover-transition-bg p-0.5 rounded"
          onClick={(e) => {
            e.stopPropagation();
            props.deleteTab();
          }}
        />
      </Show>
    </div>
  );
}

export function Tabs() {
  const [tabs] = tabDataStore;
  const createTab = useCreateTab();
  const deleteTab = useDeleteTab();
  const navigate = useNavigateToTab();
  return (
    <Show when={viewerHasVisiblePagesSignal()}>
      <div class="w-full h-7 rounded-full flex px-1.5 shrink items-center">
        <For each={tabs}>
          {(tab, index) => (
            <Tab
              label={tab.label}
              location={tab.locationHash || ''}
              index={index()}
              id={tab.id}
              tabCount={tabs.length}
              clickHandler={() => navigate(tab.id)}
              deleteTab={() => deleteTab(tab.id)}
            />
          )}
        </For>
        <Show when={tabs.length < MAX_TAB_COUNT}>
          <button
            onClick={() => createTab()}
            class="shrink-0 p-2 aspect-square rounded-lg flex items-center justify-center hover:bg-hover hover-transition-bg"
          >
            <PlusIcon width={16} height={16} class="text-ink-muted" />
          </button>
        </Show>
      </div>
    </Show>
  );
}

import { useCurrentPageNumber } from '@block-pdf/signal/pdfViewer';
import {
  MAX_TAB_COUNT,
  useCreateTab,
  useDeleteTab,
  useNavigateToTab,
} from '@block-pdf/signal/tab';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { For, Show } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { usePdfViewer } from '../context/pdf-viewer-context';

interface IInternalTabProps {
  label: string;
  id: number;
  tabCount: number;
  clickHandler: () => void;
  deleteTab: () => void;
}

function Tab(props: IInternalTabProps) {
  const activeTabId = usePdfDocument().tabs.activeId;
  const currentPageNumber = useCurrentPageNumber();

  const active = () => props.id === activeTabId();

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
  const pdf = usePdfDocument();
  const tabs = pdf.tabs.items;
  const viewerHasVisiblePages = usePdfViewer().root.hasVisiblePages;
  const createTab = useCreateTab();
  const deleteTab = useDeleteTab();
  const navigate = useNavigateToTab();
  return (
    <Show when={viewerHasVisiblePages()}>
      <div class="w-full h-7 rounded-full flex px-1.5 shrink items-center">
        <For each={tabs}>
          {(tab) => (
            <Tab
              label={tab.label}
              id={tab.id}
              tabCount={pdf.tabs.count()}
              clickHandler={() => navigate(tab.id)}
              deleteTab={() => deleteTab(tab.id)}
            />
          )}
        </For>
        <Show when={pdf.tabs.count() < MAX_TAB_COUNT}>
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

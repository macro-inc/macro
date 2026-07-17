import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import type { BlockAlias, BlockName } from '@core/block';
import { EntityIcon, getPreviewItemIconType } from '@core/component/EntityIcon';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import IconGear from '@icon/macro-gear.svg';
import { AnimatedActivityIcon } from '@icon/wide-activity';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedCompanyIcon } from '@icon/wide-company';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import FileIcon from '@phosphor/file.svg';
import HomeIcon from '@phosphor/house.svg';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { blockNameToItemType } from '@service-storage/client';
import {
  type Component,
  createContext,
  createSignal,
  For,
  type ParentProps,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { SplitContent, SplitHandle } from '../layoutManager';

/**
 * Labels/icons for `component` split contents (list views, settings,
 * composers). Aligned with the mobile dock and sidebar naming.
 */
const COMPONENT_DISPLAY: Record<
  string,
  { label: string; icon: Component<{ class?: string }> }
> = {
  home: { label: 'Home', icon: HomeIcon },
  inbox: { label: 'Inbox', icon: AnimatedInboxIcon },
  activity: { label: 'Activity', icon: AnimatedActivityIcon },
  search: { label: 'Search', icon: AnimatedSearchIcon },
  agents: { label: 'Agents', icon: AnimatedStarIcon },
  mail: { label: 'Email', icon: AnimatedEmailIcon },
  documents: { label: 'Documents', icon: AnimatedFileMdIcon },
  tasks: { label: 'Tasks', icon: AnimatedTaskIcon },
  channels: { label: 'Channels', icon: AnimatedChannelIcon },
  calls: { label: 'Calls', icon: AnimatedCallIcon },
  companies: { label: 'Customers', icon: AnimatedCompanyIcon },
  folders: { label: 'Folders', icon: AnimatedFolderIcon },
  settings: { label: 'Settings', icon: IconGear },
  'email-compose': { label: 'New email', icon: AnimatedEmailIcon },
  'channel-compose': { label: 'New channel', icon: AnimatedChannelIcon },
  'task-compose': { label: 'New task', icon: AnimatedTaskIcon },
};

type HistoryEntry = {
  content: SplitContent;
  /** Index of this entry within the split's `history()`. */
  index: number;
};

type DrawerSession = {
  handle: SplitHandle;
  /** Back-stack entries snapshotted at open time, most recent first. */
  entries: HistoryEntry[];
};

type MobileHistoryDrawerState = {
  /** Open the drawer for a split's back stack. No-ops without prior entries. */
  open: (handle: SplitHandle) => void;
};

const MobileHistoryDrawerContext = createContext<MobileHistoryDrawerState>();

export function useMobileHistoryDrawer(): MobileHistoryDrawerState | undefined {
  return useContext(MobileHistoryDrawerContext);
}

/**
 * Provides the history drawer opened by long-pressing the mobile back button.
 * Mounted outside the split panels so the drawer survives the navigation (and
 * split teardown) triggered by selecting an entry.
 */
export function MobileHistoryDrawerManager(props: ParentProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [session, setSession] = createSignal<DrawerSession>();

  const open = (handle: SplitHandle) => {
    const items = handle.history();
    if (items.length <= 1) return;
    setSession({
      handle,
      entries: items
        .slice(0, -1)
        .map((content, index) => ({ content, index }))
        .reverse(),
    });
    setIsOpen(true);
  };

  return (
    <MobileHistoryDrawerContext.Provider value={{ open }}>
      {props.children}
      <MobileHistoryDrawer
        isOpen={isOpen()}
        session={session()}
        onClose={() => setIsOpen(false)}
      />
    </MobileHistoryDrawerContext.Provider>
  );
}

function ComponentEntryContent(props: { id: string }) {
  const display = () => COMPONENT_DISPLAY[props.id];
  return (
    <>
      <span class="size-5 flex items-center justify-center shrink-0 text-ink-muted">
        <Dynamic component={display()?.icon ?? FileIcon} class="size-4.5" />
      </span>
      <span class="min-w-0 truncate">{display()?.label ?? props.id}</span>
    </>
  );
}

function BlockEntryContent(props: {
  type: BlockName | BlockAlias;
  id: string;
}) {
  const [item] = useItemPreview(() => {
    const type = blockNameToItemType(props.type);
    return type === 'channel' ? { id: props.id, type } : { id: props.id, type };
  });

  const name = () => {
    const preview = item();
    if (isAccessiblePreviewItem(preview)) {
      return preview.name || blockNameToDefaultFile(props.type);
    }
    if (!preview.loading && preview.access === 'no_access') return 'No access';
    if (!preview.loading && preview.access === 'does_not_exist')
      return 'Deleted';
    return blockNameToDefaultFile(props.type);
  };

  // The preview-derived icon picks up details the raw content type lacks
  // (task subtype, channel type); fall back to the content type while loading.
  const iconType = () => {
    const preview = item();
    if (isAccessiblePreviewItem(preview))
      return getPreviewItemIconType(preview);
    return props.type;
  };

  return (
    <>
      <span class="size-5 flex items-center justify-center shrink-0">
        <EntityIcon targetType={iconType()} size="sm" />
      </span>
      <span class="min-w-0 truncate">{name()}</span>
    </>
  );
}

function HistoryEntryButton(props: {
  content: SplitContent;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-history-entry
      class="flex items-center gap-3 px-4 py-3 text-sm text-ink hover:bg-hover hover-transition-bg text-left not-last:mb-px bg-surface"
      onClick={() => props.onSelect()}
    >
      <Show
        when={props.content.type !== 'component'}
        fallback={<ComponentEntryContent id={props.content.id} />}
      >
        <BlockEntryContent
          type={props.content.type as BlockName | BlockAlias}
          id={props.content.id}
        />
      </Show>
    </button>
  );
}

function MobileHistoryDrawer(props: {
  isOpen: boolean;
  session: DrawerSession | undefined;
  onClose: () => void;
}) {
  const selectEntry = (entry: HistoryEntry) => {
    if (!props.isOpen) return;
    const handle = props.session?.handle;
    props.onClose();
    handle?.goBackToHistoryEntry(entry.index);
  };

  return (
    <MobileDrawer
      side="bottom"
      open={props.isOpen}
      closeOnOutsidePointerStrategy="pointerdown"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Navigation history">
          <MobileDrawer.Handle />
          <MobileDrawer.Label as="h2">History</MobileDrawer.Label>
          <div class="min-h-0 flex-1 overflow-y-auto pb-2">
            <MobileDrawer.Section class="flex flex-col">
              <Suspense>
                <For each={props.session?.entries ?? []}>
                  {(entry) => (
                    <HistoryEntryButton
                      content={entry.content}
                      onSelect={() => selectEntry(entry)}
                    />
                  )}
                </For>
              </Suspense>
            </MobileDrawer.Section>
          </div>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

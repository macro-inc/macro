import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { triggerFocusInput } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import { createEffect, createSignal, type JSX, onCleanup } from 'solid-js';
import {
  createSoupEntityActions,
  viewedProjectIdFromContent,
} from './createSoupEntityActions';
import { SoupEntityActionDrawer } from './SoupEntityActionDrawer';
import {
  type EntityActionDrawerEntry,
  SoupEntityActionDrawerContextProvider,
  type SoupEntityActionDrawerState,
  useSoupEntityActionDrawer,
} from './SoupEntityActionDrawerContext';

function ConfiguredSoupEntityActionDrawer() {
  const panel = useSplitPanelOrThrow();
  const drawerState = useSoupEntityActionDrawer();
  const { buildActionGroups } = createSoupEntityActions();

  if (!drawerState) {
    console.warn('SoupEntityActionDrawer: no drawer state');
    return null;
  }

  const groups = () => {
    const entry = drawerState.entry();
    if (!entry) return [];

    const content = panel.handle.content();
    return buildActionGroups(entry.list, [entry.entity], {
      viewContext: entry.viewContext,
      viewedProjectId: viewedProjectIdFromContent(content),
      splitHandle: panel.handle,
    });
  };

  return (
    <SoupEntityActionDrawer
      entity={drawerState.entry()?.entity}
      groups={groups()}
      open={drawerState.isOpen()}
      onOpenChange={(open) => {
        if (!open) drawerState.close();
      }}
      beforeAction={(action, trigger) => {
        if (action.id !== 'share') return;

        triggerFocusInput(getShareDrawerRecipientInput, trigger);
      }}
    />
  );
}

export function MaybeSoupEntityActionDrawerManager(props: {
  children: JSX.Element;
}) {
  if (!isMobile()) return props.children;

  const [isOpen, setIsOpen] = createSignal(false);
  const [entry, setEntry] = createSignal<EntityActionDrawerEntry>();

  const ctx: SoupEntityActionDrawerState = {
    isOpen,
    entry,
    open: (nextEntry) => {
      setEntry(() => nextEntry);
      setIsOpen(true);
    },
    close: () => setIsOpen(false),
  };

  let wrapperEl!: HTMLDivElement;

  createEffect(() => {
    if (!isOpen()) return;
    const block = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    wrapperEl.addEventListener('touchmove', block, {
      capture: true,
      passive: false,
    });
    onCleanup(() =>
      wrapperEl.removeEventListener('touchmove', block, { capture: true })
    );
  });

  return (
    <SoupEntityActionDrawerContextProvider value={ctx}>
      <div
        class="flex size-full min-h-0 min-w-0 flex-1 flex-col"
        ref={wrapperEl}
      >
        {props.children}
      </div>
      <ConfiguredSoupEntityActionDrawer />
    </SoupEntityActionDrawerContextProvider>
  );
}

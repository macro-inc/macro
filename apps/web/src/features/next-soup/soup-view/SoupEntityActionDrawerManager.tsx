import { SoupEntityActionDrawer } from '@app/features/soup';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { triggerFocusInput } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { createEffect, createSignal, type JSX, onCleanup } from 'solid-js';
import type { SoupState } from '../create-soup-state';
import {
  createSoupEntityActions,
  viewedProjectIdFromContent,
} from './create-soup-entity-actions';
import {
  SoupEntityActionDrawerContextProvider,
  type SoupEntityActionDrawerState,
  useSoupEntityActionDrawer,
} from './soup-entity-action-drawer-context';
import { useSoupView } from './soup-view-context';

function ConfiguredSoupEntityActionDrawer() {
  const panel = useSplitPanelOrThrow();
  const drawerState = useSoupEntityActionDrawer();
  const { activeTab } = useSoupView();
  const { buildActionGroups } = createSoupEntityActions();

  if (!drawerState) {
    console.warn('SoupEntityActionDrawer: no drawer state');
    return null;
  }

  const groups = () => {
    const entity = drawerState.entity();
    const soup = drawerState.soup();
    if (!entity || !soup) return [];

    const content = panel.handle.content();
    return buildActionGroups(soup, [entity], {
      activeTab: activeTab(),
      activeListView: content.id,
      viewedProjectId: viewedProjectIdFromContent(content),
      splitHandle: panel.handle,
    });
  };

  return (
    <SoupEntityActionDrawer
      entity={drawerState.entity()}
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

/**
 * On mobile: provides drawer context and renders the SoupEntityActionDrawer
 * (opened via long-press on soup entity rows).
 * On desktop: renders children as-is with no context, signals, or drawer.
 */
export function MaybeSoupEntityActionDrawerManager(props: {
  children: JSX.Element;
}) {
  if (!isMobile()) return props.children;

  const [isOpen, setIsOpen] = createSignal(false);
  const [entity, setEntity] = createSignal<EntityData | undefined>();
  const [soup, setSoup] = createSignal<SoupState | undefined>();

  const ctx: SoupEntityActionDrawerState = {
    isOpen,
    entity,
    soup,
    open: (e: EntityData, s: SoupState) => {
      setEntity(() => e);
      setSoup(() => s);
      setIsOpen(true);
    },
    close: () => setIsOpen(false),
  };

  let wrapperEl!: HTMLDivElement;

  // Block in-progress touch sequences (scroll, swipe) the moment the drawer opens.
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
      <div class="size-full" ref={wrapperEl}>
        {props.children}
      </div>
      <ConfiguredSoupEntityActionDrawer />
    </SoupEntityActionDrawerContextProvider>
  );
}

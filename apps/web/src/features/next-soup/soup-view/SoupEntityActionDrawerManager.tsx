import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { createEffect, createSignal, type JSX, onCleanup } from 'solid-js';
import type { SoupState } from '../create-soup-state';
import { SoupEntityActionDrawer } from './SoupEntityActionDrawer';
import {
  SoupEntityActionDrawerContextProvider,
  type SoupEntityActionDrawerState,
} from './soup-entity-action-drawer-context';

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
      <SoupEntityActionDrawer />
    </SoupEntityActionDrawerContextProvider>
  );
}

import { isMobile } from '@core/mobile/isMobile';
import type { EntityData } from '@entity';
import { createSignal, type JSX } from 'solid-js';
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

  return (
    <SoupEntityActionDrawerContextProvider value={ctx}>
      {props.children}
      <SoupEntityActionDrawer />
    </SoupEntityActionDrawerContextProvider>
  );
}

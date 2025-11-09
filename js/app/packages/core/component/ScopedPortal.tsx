import { getSplitPanelRef } from '@app/component/split-layout/layoutUtils';
import { isInBlock } from '@core/block';
import { blockElementSignal } from '@core/signal/blockElement';
import type { ComponentProps } from 'solid-js';
import { Portal, Show } from 'solid-js/web';

export type PortalScope = 'local' | 'block' | 'global' | 'split';

/**
 * Portal with some extra scoping logic. If passed a specific mount prop or no props at all – it is
 * just a regular solid Portal.
 * @param props.scope - The scope of the portal. If 'local' it will mount to the closest element with the
 *    '.portal-scope' class. If 'block' it will mount to the containing block element. If 'global' it will
 *    mount to the document body.
 * @returns
 */
export function ScopedPortal(
  props: ComponentProps<typeof Portal> & {
    scope?: PortalScope;
    show?: boolean;
  }
) {
  let searchRef!: HTMLDivElement;

  const mountRef = () => {
    if (props.mount) return props.mount;
    if (props.scope === 'block') {
      if (isInBlock()) {
        const blockElement = blockElementSignal.get();
        if (blockElement) return blockElement;
      }
    }
    if (props.scope === 'split') {
      const panelElement =
        getSplitPanelRef() || searchRef.closest('[data-split-panel]');
      if (panelElement) return panelElement;
    }
    if (props.scope === 'local') {
      const scopedElement = searchRef.closest('.portal-scope');
      if (scopedElement) return scopedElement;
    }
    return document.body;
  };

  return (
    <Show when={props.show !== false}>
      <div class="hidden" ref={searchRef} />
      <Portal mount={mountRef()}>{props.children}</Portal>
    </Show>
  );
}

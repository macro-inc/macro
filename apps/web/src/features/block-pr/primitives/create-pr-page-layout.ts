import type { SidePanelContextType } from '@components/app/side-panel/context';
import { createElementSize } from '@solid-primitives/resize-observer';
import { type Accessor, createEffect, createSignal } from 'solid-js';

/** The page owns docking geometry while SidePanel.Root owns the saved preference. */
export function createPrPageLayout(
  changesVisible: Accessor<boolean>,
  sidePanel?: Pick<SidePanelContextType, 'isOpen' | 'setIsOverlayMode'>
) {
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const size = createElementSize(root);
  const width = () => size.width ?? 0;
  const floatingDetails = () => width() < 1224 || changesVisible();
  // Root starts in closed overlay mode until its layout reports actual geometry.
  createEffect(() => sidePanel?.setIsOverlayMode(floatingDetails()));
  return {
    setRoot,
    width,
    floatingDetails,
    dockedDetails: () => !floatingDetails() && Boolean(sidePanel?.isOpen()),
  };
}

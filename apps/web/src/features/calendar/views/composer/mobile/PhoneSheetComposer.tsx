import { SplitPanelContext } from '@components/app/split-layout/context';
import { type ComponentProps, useContext } from 'solid-js';
import { MobileComposer } from './MobileComposer';

/** The existing touch popover owns the drawer, its chrome, and its only scroller. */
export function PhoneSheetComposer(
  props: Omit<
    ComponentProps<typeof MobileComposer>,
    'headerMount' | 'footerMount' | 'scrollElement'
  > & { initialHeight?: number }
) {
  const panel = useContext(SplitPanelContext);
  panel?.fillDrawer?.(props.initialHeight ?? 92, { opaque: true });
  return (
    <MobileComposer
      {...props}
      headerMount={panel?.drawerHeader?.()}
      footerMount={panel?.drawerFooter?.()}
      scrollElement={() => panel?.drawerScrollBody?.()}
    />
  );
}

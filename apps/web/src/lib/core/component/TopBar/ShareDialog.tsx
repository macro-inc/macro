import { isMobile } from '@core/mobile/isMobile';
import { type JSX, Show } from 'solid-js';
import { ShareDialogFrame } from './ShareDialogFrame';
import { ShareDrawer } from './ShareDrawer';

/**
 * The Share menu's frame: on desktop, the Share dialog's column of cards; on
 * phones, the Share drawer.
 */
export function ShareDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}) {
  return (
    <Show
      when={!isMobile()}
      fallback={
        <ShareDrawer open={props.open} onOpenChange={props.onOpenChange}>
          {props.children}
        </ShareDrawer>
      }
    >
      <ShareDialogFrame open={props.open} onOpenChange={props.onOpenChange}>
        {props.children}
      </ShareDialogFrame>
    </Show>
  );
}

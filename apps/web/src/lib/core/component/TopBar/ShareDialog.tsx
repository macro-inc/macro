import { isMobile } from '@core/mobile/isMobile';
import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import { type JSX, Show } from 'solid-js';
import { ShareDrawer } from './ShareDrawer';

/**
 * The Share menu's frame: on desktop, a column of cards anchored near the top
 * of the window; on phones, the Share drawer.
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
      <KobalteDialog onOpenChange={props.onOpenChange} open={props.open}>
        <KobalteDialog.Portal>
          <KobalteDialog.Overlay class="z-modal fixed inset-0 scrim-glass" />
          <div class="z-modal fixed inset-0">
            <KobalteDialog.Content
              class="max-w-[calc(100vw-16px)] mt-20 sm:mt-40 mx-auto overflow-y-auto scrollbar-hidden portal-scope isolate flex flex-col gap-2 *:max-h-[75vh]"
              style={{ width: '800px' }}
            >
              {props.children}
            </KobalteDialog.Content>
          </div>
        </KobalteDialog.Portal>
      </KobalteDialog>
    </Show>
  );
}

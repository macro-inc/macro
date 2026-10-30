import { isMobile } from '@core/mobile/isMobile';
import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import { cn, Panel } from '@ui';
import { Dialog } from '@ui/components/Dialog';
import type { JSX, ParentProps } from 'solid-js';
import { Show } from 'solid-js';

/**
 * The Share dialog's frame: a column of cards below the top of the window on
 * desktop, one drawer on phones.
 */
export function ShareDialogFrame(
  props: ParentProps<{ open: boolean; onOpenChange(open: boolean): void }>
) {
  return (
    <Show
      when={!isMobile()}
      fallback={
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
          <div class="flex flex-col">{props.children}</div>
        </Dialog>
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

/** One card of the Share dialog; on phones, a section of its drawer. */
export function ShareCard(
  props: ParentProps<{ header?: JSX.Element; bodyClass?: string }>
) {
  return (
    <Panel
      depth={2}
      hideBorder
      class={cn(
        'rounded-[24px] bg-dialog',
        isMobile() ? 'rounded-none bg-transparent' : 'elevated-surface'
      )}
    >
      <Show when={props.header}>
        <Panel.Header class="px-4">{props.header}</Panel.Header>
      </Show>
      <Panel.Body class={props.bodyClass}>{props.children}</Panel.Body>
    </Panel>
  );
}

/** The Share dialog's title: what is being shared. */
export function ShareDialogTitle(props: { icon: JSX.Element; name: string }) {
  return (
    <Dialog.Title class="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap w-full text-sm font-medium">
      <span class="shrink-0">Share:</span>
      {props.icon}
      <span class="truncate">{props.name}</span>
    </Dialog.Title>
  );
}

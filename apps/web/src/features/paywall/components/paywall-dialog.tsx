import { Dialog, Surface } from '@ui';
import type { JSX } from 'solid-js';

/** Shared modal shell for the real paywall and local state preview. */
export function PaywallDialog(props: {
  open: boolean;
  onClose: () => void;
  contentRef?: (element: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="w-225"
    >
      <Surface depth={2} class="rounded-xl">
        <div
          class="*:max-h-[85vh] font-sans"
          ref={props.contentRef}
          tabIndex={-1}
        >
          <div class="overflow-y-auto">{props.children}</div>
        </div>
      </Surface>
    </Dialog>
  );
}

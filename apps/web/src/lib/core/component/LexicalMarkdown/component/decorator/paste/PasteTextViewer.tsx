import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import Copy from '@phosphor/copy.svg';
import { Button, Dialog } from '@ui';
import { Show } from 'solid-js';

/**
 * The full text behind a paste or referenced-text chip, styled like a code
 * fence: a scrollable dialog on desktop and a bottom drawer on mobile, both
 * dismissable with `esc` or by clicking outside.
 */
export function PasteTextViewer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
  onCopy: () => void;
}) {
  const lineCount = () => props.content.split('\n').length;
  const lineLabel = () =>
    `${lineCount()} ${lineCount() === 1 ? 'line' : 'lines'}`;

  const header = () => (
    <>
      <span>{props.title}</span>
      <div class="flex items-center gap-2">
        <span>{lineLabel()}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-ink-extra-muted/50"
          tooltip="Copy"
          on:click={() => props.onCopy()}
        >
          <Copy />
        </Button>
      </div>
    </>
  );

  const fullText = () => (
    <pre class="font-mono text-sm leading-relaxed bg-message p-4 m-0 whitespace-pre-wrap wrap-break-word overflow-auto">
      {props.content}
    </pre>
  );

  return (
    <Show
      when={isMobileWidth()}
      fallback={
        <Dialog
          open={props.open}
          onOpenChange={props.onOpenChange}
          position="center"
          class="rounded-lg border border-edge bg-surface shadow-lg"
        >
          <div class="flex items-center justify-between px-4 py-2 border-b border-edge text-xs text-ink-muted">
            {header()}
          </div>
          <div class="max-h-[70vh] overflow-auto">{fullText()}</div>
        </Dialog>
      }
    >
      <MobileDrawer
        side="bottom"
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label={props.title}>
            <MobileDrawer.Handle />
            <div class="flex items-center justify-between px-4 pb-2 text-xs text-ink-muted shrink-0">
              {header()}
            </div>
            <MobileDrawer.ScrollBody class="overflow-x-auto">
              {fullText()}
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}

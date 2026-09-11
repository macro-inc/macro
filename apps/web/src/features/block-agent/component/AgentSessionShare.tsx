import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { isMobile } from '@core/mobile/isMobile';
import LinkIcon from '@phosphor/link.svg';
import ShareIcon from '@phosphor/share.svg';
import { Button, ButtonGroup, Dialog } from '@ui';
import { type ComponentProps, createSignal, Show, Suspense } from 'solid-js';

export function AgentSessionShareTrigger(props: {
  onShare: () => void;
  onCopyLink: () => void;
}) {
  return (
    <ButtonGroup variant="outline" size="sm" class="bg-surface" depth={2}>
      <Button onClick={props.onShare}>
        <ShareIcon />
        Share
      </Button>
      <ButtonGroup.Divider />
      <Button
        tooltip="Copy Share Link"
        size="icon-sm"
        onClick={props.onCopyLink}
      >
        <LinkIcon class="size-3.5!" />
      </Button>
    </ButtonGroup>
  );
}

type ForwardHandle = Parameters<
  NonNullable<ComponentProps<typeof ForwardToChannel>['ref']>
>[0];

export function AgentSessionShareDialog(props: {
  sessionId: string;
  name: string;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopyLink: () => void;
}) {
  const [forward, setForward] = createSignal<ForwardHandle>();
  const close = () => props.onOpenChange(false);

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      visibleScrim
      class="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-y-auto border border-edge-muted"
    >
      <Dialog.Title class="truncate px-4 pt-4 text-sm font-medium">
        Share: {props.name}
      </Dialog.Title>
      <Dialog.Description class="px-4 py-3 text-sm text-ink-muted">
        {props.isOwner
          ? 'Recipients can view and control this agent session.'
          : 'Only the owner can share access to this session. You can copy a link for people who already have access.'}
      </Dialog.Description>
      <Show when={props.isOwner}>
        <Suspense
          fallback={
            <div class="px-4 py-3 text-sm text-ink-muted">
              Loading recipients…
            </div>
          }
        >
          <ForwardToChannel
            ref={setForward}
            blockId={props.sessionId}
            blockName="agent"
            name={props.name}
            hideAccessLevelSelector
            onSubmit={close}
            onCancel={close}
          />
          <Show when={isMobile()}>
            <div class="flex justify-end gap-2 px-4 py-3">
              <Button onClick={close}>Cancel</Button>
              <Button
                variant="accent"
                disabled={!forward()?.getSelectedOptions().length}
                onClick={() => forward()?.handleSubmit()}
              >
                Share
              </Button>
            </div>
          </Show>
        </Suspense>
      </Show>
      <div class="flex items-center justify-between gap-2 border-t border-edge-muted px-4 py-3">
        <Button variant="outline" size="sm" onClick={props.onCopyLink}>
          <LinkIcon />
          Copy link
        </Button>
        <Show when={!props.isOwner}>
          <Button size="sm" onClick={close}>
            Done
          </Button>
        </Show>
      </div>
    </Dialog>
  );
}

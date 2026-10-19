import { toShareItem } from '@app/features/sharing/share-delivery/share-delivery';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { EntityIcon } from '@core/component/EntityIcon';
import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import { Dialog } from '@kobalte/core/dialog';
import CopyIcon from '@phosphor/copy.svg';
import { createCallback } from '@solid-primitives/rootless';
import { Button, Panel } from '@ui';
import { type Accessor, createMemo, createSignal, Show } from 'solid-js';

interface PrShareModalProps {
  foreignEntityId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function prShareUrl(foreignEntityId: string): string {
  return buildSimpleEntityUrl({ type: 'pr', id: foreignEntityId });
}

function PrShareModal(props: PrShareModalProps) {
  const copyEntityLink = useCopyLink();
  const shareItem = createMemo(() =>
    toShareItem({
      id: props.foreignEntityId,
      kind: 'foreign',
      name: props.name,
      canGrant: false,
    })
  );

  const copyLink = createCallback(() => {
    fireAndForget(
      copyEntityLink(prShareUrl(props.foreignEntityId)),
      'pr-share-modal'
    );
  });

  return (
    <Show
      when={!isMobile()}
      fallback={
        <MobileDrawer
          open={props.open}
          onOpenChange={props.onOpenChange}
          closeOnOutsidePointerStrategy="pointerdown"
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay />
            <MobileDrawer.Content
              aria-label="Share"
              class="h-[80vh] overflow-y-auto"
            >
              <div class="flex justify-center pt-3 pb-1 shrink-0">
                <div class="w-10 h-1 rounded-full bg-edge-muted" />
              </div>
              <div class="shrink-0 flex items-center justify-between px-3 text-sm font-medium text-ink min-h-11">
                <div class="flex items-center gap-1.5 flex-1 min-w-0">
                  <EntityIcon targetType="pr" size="sm" class="shrink-0" />
                  <span class="truncate">{props.name}</span>
                </div>
              </div>
              <div class="border-b border-edge-muted mb-2" />
              <ForwardToChannel
                item={shareItem()}
                onSubmit={() => props.onOpenChange(false)}
              />
              <div class="px-4 py-3 border-t border-edge-muted">
                <Button variant="outline" onClick={copyLink}>
                  <CopyIcon class="size-4" />
                  <span>Copy Link</span>
                </Button>
              </div>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      }
    >
      <Dialog onOpenChange={props.onOpenChange} open={props.open}>
        <Dialog.Portal>
          <Dialog.Overlay class="z-modal fixed inset-0 scrim-glass" />
          <div class="z-modal fixed inset-0">
            <Dialog.Content
              class="max-w-[calc(100vw-16px)] mt-20 sm:mt-40 mx-auto overflow-y-auto scrollbar-hidden portal-scope isolate flex flex-col gap-2 *:max-h-[75vh]"
              style={{ width: '800px' }}
            >
              <Panel depth={2} class="rounded-xl bg-dialog">
                <Panel.Header class="px-4">
                  <Dialog.Title class="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap w-full text-sm font-medium">
                    <span class="shrink-0">Share:</span>
                    <EntityIcon targetType="pr" size="sm" class="shrink-0" />
                    <span class="truncate">{props.name}</span>
                  </Dialog.Title>
                </Panel.Header>
                <Panel.Body>
                  <ForwardToChannel
                    item={shareItem()}
                    onSubmit={() => props.onOpenChange(false)}
                    onCancel={() => props.onOpenChange(false)}
                  />
                </Panel.Body>
              </Panel>
              <Panel depth={2} class="rounded-xl bg-dialog">
                <Panel.Body>
                  <div class="flex items-center justify-between p-4 text-sm">
                    <span class="text-ink-muted">
                      Anyone with access to the PR on GitHub can view it in
                      Macro
                    </span>
                    <Button variant="outline" onClick={copyLink}>
                      <CopyIcon class="size-4" />
                      <span>Copy Link</span>
                    </Button>
                  </div>
                </Panel.Body>
              </Panel>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </Show>
  );
}

/**
 * Hook to manage PR share modal state. Returns the modal component and an
 * opener function.
 */
export function usePrShare(
  foreignEntityId: Accessor<string>,
  name: Accessor<string>
) {
  const [open, setOpen] = createSignal(false);

  const openShare = () => setOpen(true);

  const ShareModal = () => (
    <PrShareModal
      foreignEntityId={foreignEntityId()}
      name={name()}
      open={open()}
      onOpenChange={setOpen}
    />
  );

  return { openShare, ShareModal, isOpen: open };
}

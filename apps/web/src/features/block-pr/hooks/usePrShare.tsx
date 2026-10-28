import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { EntityIcon } from '@core/component/EntityIcon';
import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { useCopyLink } from '@core/util/useCopyLink';
import CopyIcon from '@icon/system/regular/copy.svg';
import { Dialog } from '@kobalte/core/dialog';
import { Button, Panel } from '@ui';
import { type Accessor, createSignal, Show } from 'solid-js';

interface PrShareModalProps {
  foreignEntityId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copyLink: () => Promise<boolean>;
}

function prShareUrl(foreignEntityId: string): string {
  return buildSimpleEntityUrl({ type: 'pr', id: foreignEntityId });
}

function PrShareModal(props: PrShareModalProps) {
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
                entity={{
                  entity_type: 'foreign_entity',
                  entity_id: props.foreignEntityId,
                }}
                name={props.name}
                onSubmit={() => props.onOpenChange(false)}
                submitPermissionInfo={undefined}
              />
              <div class="px-4 py-3 border-t border-edge-muted">
                <Button
                  variant="outline"
                  onClick={() =>
                    fireAndForget(props.copyLink(), 'pr-share-modal')
                  }
                >
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
              <Panel
                depth={2}
                hideBorder
                class="elevated-surface rounded-[24px] bg-dialog"
              >
                <Panel.Header class="px-4">
                  <Dialog.Title class="flex items-center gap-1.5 min-w-0 overflow-hidden whitespace-nowrap w-full text-sm font-medium">
                    <span class="shrink-0">Share:</span>
                    <EntityIcon targetType="pr" size="sm" class="shrink-0" />
                    <span class="truncate">{props.name}</span>
                  </Dialog.Title>
                </Panel.Header>
                <Panel.Body>
                  <ForwardToChannel
                    entity={{
                      entity_type: 'foreign_entity',
                      entity_id: props.foreignEntityId,
                    }}
                    name={props.name}
                    onSubmit={() => props.onOpenChange(false)}
                    onCancel={() => props.onOpenChange(false)}
                    submitPermissionInfo={undefined}
                  />
                </Panel.Body>
              </Panel>
              <Panel
                depth={2}
                hideBorder
                class="elevated-surface rounded-[24px] bg-dialog"
              >
                <Panel.Body>
                  <div class="flex items-center justify-between p-4 text-sm">
                    <span class="text-ink-muted">
                      Anyone with access to the PR on GitHub can view it in
                      Macro
                    </span>
                    <Button
                      variant="outline"
                      onClick={() =>
                        fireAndForget(props.copyLink(), 'pr-share-modal')
                      }
                    >
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
 * Hook to manage PR share modal state. Returns the modal component, an opener
 * function, and the share link copy the modal and header both offer.
 */
export function usePrShare(
  foreignEntityId: Accessor<string>,
  name: Accessor<string>
) {
  const [open, setOpen] = createSignal(false);
  const copyEntityLink = useCopyLink();

  const openShare = () => setOpen(true);
  const copyLink = () => copyEntityLink(prShareUrl(foreignEntityId()));

  const ShareModal = () => (
    <PrShareModal
      foreignEntityId={foreignEntityId()}
      name={name()}
      open={open()}
      onOpenChange={setOpen}
      copyLink={copyLink}
    />
  );

  return { openShare, copyLink, ShareModal, isOpen: open };
}

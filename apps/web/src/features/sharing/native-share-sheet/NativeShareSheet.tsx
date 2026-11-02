import { ConfirmDrawer } from '@components/app/mobile/ConfirmDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazyNamed } from '@core/util/lazyNamed';
import { type PendingShareFile, useShareTarget, useTauri } from '@macro/tauri';
import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { ShareSheetHeaderActions } from './share-sheet-header';

const NativeShareSheetComposer = lazyNamed(
  () => import('./NativeShareSheetComposer'),
  'NativeShareSheetComposer'
);

// Use the current staged file tokens as the share-session identity.
function pendingShareBatchKey(files: readonly PendingShareFile[]): string {
  return files.map((file) => file.token).join('|');
}

export function NativeShareSheet() {
  const tauri = useTauri();
  const shareTarget = useShareTarget();
  const [confirmDiscard, setConfirmDiscard] = createSignal(false);

  const pendingFiles = () => shareTarget?.pendingShareFiles() ?? [];
  const shareBatchKey = () => pendingShareBatchKey(pendingFiles());
  const isOpen = () =>
    pendingFiles().length > 0 &&
    (tauri?.os === 'ios' || tauri?.os === 'android');
  const [awaitingFirstInteraction, setAwaitingFirstInteraction] =
    createSignal(false);

  createEffect(
    on(isOpen, (open) => {
      if (!open) {
        setConfirmDiscard(false);
        setAwaitingFirstInteraction(false);
        return;
      }

      setAwaitingFirstInteraction(true);

      const releaseDismissGuard = () => {
        setAwaitingFirstInteraction(false);
      };

      window.addEventListener('pointerdown', releaseDismissGuard, true);
      window.addEventListener('keydown', releaseDismissGuard, true);

      onCleanup(() => {
        window.removeEventListener('pointerdown', releaseDismissGuard, true);
        window.removeEventListener('keydown', releaseDismissGuard, true);
      });
    })
  );

  const handleCancel = () => {
    setConfirmDiscard(false);
    fireAndForget(shareTarget?.clearPendingShareFiles(), 'native-share-sheet');
  };

  return (
    <Show when={tauri?.os === 'ios' || tauri?.os === 'android'}>
      <MobileDrawer
        side="bottom"
        open={isOpen()}
        closeOnOutsidePointerStrategy="pointerdown"
        closeOnOutsideFocus={false}
        preventScroll={false}
        preventScrollbarShift={false}
        restoreFocus={false}
        noOutsidePointerEvents={false}
        onOpenChange={(open) => {
          const closeGuardActive =
            !open && isOpen() && awaitingFirstInteraction();

          if (closeGuardActive) return;

          if (!open && isOpen()) {
            if (tauri?.os === 'android') setConfirmDiscard(true);
            else handleCancel();
          }
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Share to Macro" targetHeight={80}>
            <MobileDrawer.Handle />
            {/* Keyed on the batch so each incoming share remounts the composer. */}
            <Show when={isOpen() ? shareBatchKey() : undefined} keyed>
              {(_batchKey) => (
                <Suspense
                  fallback={
                    <ShareSheetHeaderActions
                      canSend={() => false}
                      handleCancel={handleCancel}
                      handleSend={() => {}}
                    />
                  }
                >
                  <NativeShareSheetComposer handleCancel={handleCancel} />
                </Suspense>
              )}
            </Show>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <ConfirmDrawer
        open={confirmDiscard()}
        onOpenChange={setConfirmDiscard}
        title="Discard this share?"
        body="Your message and shared attachments will be removed."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          handleCancel();
        }}
      />
    </Show>
  );
}

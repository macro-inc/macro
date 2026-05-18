import { useAiDataConsent } from '@core/context/user';
import CloseIcon from '@phosphor/x.svg';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { authServiceClient } from '@service-auth/client';
import { Button, Dialog, Surface } from '@ui';
import { createSignal } from 'solid-js';

export function useAiDataConsentGate() {
  const hasConsent = useAiDataConsent();
  const [open, setOpen] = createSignal(false);

  let storedCallback: (() => void) | undefined;

  function requestConsent(onAccept: () => void) {
    storedCallback = onAccept;
    setOpen(true);
  }

  async function grantConsent() {
    await authServiceClient.patchAiConsent({ aiDataConsent: true });
    await invalidateUserInfo();
    setOpen(false);
    const cb = storedCallback;
    storedCallback = undefined;
    cb?.();
  }

  function denyConsent() {
    setOpen(false);
    storedCallback = undefined;
  }

  function ConsentDialog() {
    return (
      <Dialog
        open={open()}
        onOpenChange={(isOpen) => !isOpen && denyConsent()}
        class="w-120"
      >
        <Surface depth={2} active class="rounded-xl">
          <div class="*:max-h-[75vh]">
            <div class="flex flex-row items-center justify-between px-2 h-10 gap-2 border-b border-b-edge-muted">
              <div class="flex flex-row items-center gap-2">
                <Dialog.CloseButton>
                  <Button label="Close" variant="ghost" size="icon-sm">
                    <CloseIcon />
                  </Button>
                </Dialog.CloseButton>
                <Dialog.Title>AI Data Sharing</Dialog.Title>
              </div>
            </div>
            <div class="p-3">
              <p class="text-ink-muted text-sm">
                AI Chat sends your messages to Anthropic for processing and may
                access your files in Macro to provide relevant responses. Your
                data is not retained or used for training.
              </p>
              <div class="flex justify-end mt-4 gap-2">
                <Button variant="base" onClick={denyConsent}>
                  Cancel
                </Button>
                <Button variant="base" onClick={grantConsent}>
                  Accept
                </Button>
              </div>
            </div>
          </div>
        </Surface>
      </Dialog>
    );
  }

  return {
    hasConsent,
    requestConsent,
    ConsentDialog,
  };
}

import { Dialog } from '@kobalte/core/dialog';
import { useAiDataConsent } from '@core/context/user';
import { authServiceClient } from '@service-auth/client';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { DeprecatedButton } from '@core/component/FormControls/DeprecatedButton';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { DialogWrapper } from '@core/component/DialogWrapper';

import CloseIcon from '@icon/regular/x.svg';
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
      <Dialog open={open()} onOpenChange={(isOpen) => !isOpen && denyConsent()}>
        <Dialog.Portal>
          <DialogWrapper width="480px">
            <div class="flex flex-row items-center justify-between px-2 h-[40px] gap-2 border-b border-b-edge-muted">
              <div class="flex flex-row items-center gap-2">
                <Dialog.CloseButton>
                  <DeprecatedIconButton
                    tooltip={{ label: 'Close' }}
                    icon={CloseIcon}
                    iconSize={16}
                    theme="clear"
                    size="sm"
                  />
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
                <DeprecatedButton theme="secondary" onClick={denyConsent}>
                  Cancel
                </DeprecatedButton>
                <DeprecatedButton theme="primary" onClick={grantConsent}>
                  Accept
                </DeprecatedButton>
              </div>
            </div>
          </DialogWrapper>
        </Dialog.Portal>
      </Dialog>
    );
  }

  return {
    hasConsent,
    requestConsent,
    ConsentDialog,
  };
}

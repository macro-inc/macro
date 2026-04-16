import { useSplitLayout } from '@app/component/split-layout/layout';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { getDestinationFromOptions } from '@core/component/NewMessage';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { CombinedRecipientItem, WithCustomUserInput } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import { toast } from '@core/component/Toast/Toast';
import { commsServiceClient } from '@service-comms/client';
import PhoneCallIcon from '@icon/duotone/phone-call-duotone.svg';
import XIcon from '@icon/regular/x.svg';
import { Dialog } from '@kobalte/core/dialog';
import { createSignal, Show } from 'solid-js';
import { Button } from '@ui/components/Button';

export function NewCallButton() {
  const [isOpen, setIsOpen] = createSignal(false);
  const { all: destinationOptions } = useCombinedRecipients();
  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);
  const [triedToSubmit, setTriedToSubmit] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const { replaceSplit } = useSplitLayout();

  function reset() {
    setSelectedOptions([]);
    setTriedToSubmit(false);
    setIsSubmitting(false);
  }

  async function handleStartCall() {
    const options = selectedOptions();
    if (!options || options.length === 0) {
      setTriedToSubmit(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const destination = getDestinationFromOptions(options);
      let channelId: string;

      if (destination.type === 'channel') {
        channelId = destination.id;
      } else {
        const result =
          destination.users.length === 1
            ? await commsServiceClient.getOrCreateDirectMessage({
                recipient_id: destination.users[0],
              })
            : await commsServiceClient.getOrCreatePrivateChannel({
                recipients: destination.users,
              });

        if (isErr(result)) {
          toast.failure('Failed to create channel for call');
          setIsSubmitting(false);
          return;
        }

        channelId = result[1].channel_id;
      }

      setIsOpen(false);
      reset();

      replaceSplit({
        content: {
          type: 'channel',
          id: channelId,
          params: { join_call: 'true' },
        },
      });
    } catch {
      toast.failure('Failed to start call');
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      modal
      open={isOpen()}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) reset();
      }}
    >
      <Dialog.Trigger
        as={Button}
        variant="secondary"
        size="sm"
        class="rounded-xs whitespace-nowrap px-2 text-ink-muted hover:text-ink"
      >
        <PhoneCallIcon class="size-3.5" />
        New Call
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed flex inset-0 z-modal bg-modal-overlay items-center justify-center text-ink transition-[max-height] duration-350 ease-out sm:transition-none portal-scope">
          <Dialog.Content class="w-[512px] bg-dialog rounded-lg border-edge border-1 shadow-lg">
            <div class="flex flex-row justify-between items-center p-4">
              <Dialog.Title class="font-medium text-2xl text-ink-muted">
                New Call
              </Dialog.Title>
              <Dialog.CloseButton class="text-ink-muted hover:bg-hover hover-transition-bg rounded-md p-1">
                <XIcon class="w-5 h-5" />
              </Dialog.CloseButton>
            </div>
            <div class="flex flex-col p-4 pt-0 gap-4">
              <RecipientSelector<'user' | 'contact' | 'channel'>
                options={destinationOptions}
                selectedOptions={selectedOptions()}
                setSelectedOptions={setSelectedOptions}
                placeholder="To: Macro users or email addresses"
                triedToSubmit={triedToSubmit}
                focusOnMount
                triggerMode="input"
              />
              <div class="flex justify-end">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isSubmitting()}
                  onClick={handleStartCall}
                >
                  <PhoneCallIcon class="size-3.5" />
                  {isSubmitting() ? 'Starting...' : 'Start Call'}
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog>
  );
}

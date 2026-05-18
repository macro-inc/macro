import { useSplitLayout } from '@app/component/split-layout/layout';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { getDestinationFromOptions } from '@core/util/destination';
import { isErr } from '@core/util/maybeResult';
import XIcon from '@icon/x.svg';
import PhoneCallIcon from '@macro-icons/wide/call.svg';
import { commsServiceClient } from '@service-comms/client';
import { Button, Dialog, Surface } from '@ui';
import { createSignal } from 'solid-js';

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
    } catch (err) {
      console.error('Failed to start call', err);
      toast.failure('Failed to start call');
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="base"
        size="sm"
        class="rounded-xs whitespace-nowrap px-2 text-ink-muted hover:text-ink"
        onClick={() => setIsOpen(true)}
      >
        <PhoneCallIcon class="size-3.5" />
        New Call
      </Button>
      <Dialog
        open={isOpen()}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) reset();
        }}
        class="w-lg"
      >
        <Surface depth={2} active class="rounded-xl">
          <div class="*:max-h-[75vh]">
            <div class="flex flex-col text-ink">
              <div class="shrink-0 flex flex-row items-center px-2 gap-1 border-b border-b-edge-muted h-10">
                <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
                  <XIcon />
                </Dialog.CloseButton>
                <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
                  New Call
                </Dialog.Title>
              </div>
              <div class="flex flex-col p-4 gap-4">
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
                    variant="base"
                    size="sm"
                    disabled={isSubmitting()}
                    onClick={handleStartCall}
                  >
                    <PhoneCallIcon class="size-3.5" />
                    {isSubmitting() ? 'Starting...' : 'Start Call'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Surface>
      </Dialog>
    </>
  );
}

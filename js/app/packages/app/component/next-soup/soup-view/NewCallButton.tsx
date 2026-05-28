import { useSplitLayout } from '@app/component/split-layout/layout';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { getDestinationFromOptions } from '@core/util/destination';
import PhoneCallIcon from '@icon/wide-call.svg';
import PlusCircleIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
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
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation();
  const getOrCreatePrivateChannelMutation =
    useGetOrCreatePrivateChannelMutation();

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
        try {
          const result =
            destination.users.length === 1
              ? await getOrCreateDmMutation.mutateAsync({
                  recipient_id: destination.users[0],
                })
              : await getOrCreatePrivateChannelMutation.mutateAsync({
                  recipients: destination.users,
                });
          channelId = result.channel_id;
        } catch {
          toast.failure('Failed to create channel for call');
          setIsSubmitting(false);
          return;
        }
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
        variant="active"
        class="border-0 rounded-full px-3 py-2 pl-1 font-semibold"
        size="sm"
        onClick={() => setIsOpen(true)}
      >
        <PlusCircleIcon class="size-3.5 text-accent" />
        <span>Call</span>
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

import { joinChannelCall } from '@channel/Call/join-channel-call';
import { NewMeetingButton } from '@channel/Call/NewMeetingButton';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { toast } from '@core/component/Toast/Toast';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import { getDestinationFromOptions } from '@core/util/destination';
import PhoneCallIcon from '@phosphor/phone-call.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import XIcon from '@phosphor/x.svg';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
import { Button, Dialog, Surface } from '@ui';
import { createSignal, Show } from 'solid-js';

export function NewCallButton(props: { inline?: boolean }) {
  const [isOpen, setIsOpen] = createSignal(false);
  const { all: destinationOptions } = useCombinedRecipients();
  const [selectedOptions, setSelectedOptions] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'channel'>[]
  >([]);
  const [triedToSubmit, setTriedToSubmit] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation();
  const getOrCreatePrivateChannelMutation =
    useGetOrCreatePrivateChannelMutation();

  function reset() {
    setSelectedOptions([]);
    setTriedToSubmit(false);
    setIsSubmitting(false);
  }

  async function handleStartCall() {
    if (isSubmitting()) return;
    const options = selectedOptions();
    if (!options || options.length === 0) {
      setTriedToSubmit(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const destination = getDestinationFromOptions(options);
      if (destination.type === 'users' && destination.users.length === 0) {
        setTriedToSubmit(true);
        return;
      }
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
          return;
        }
      }

      await joinChannelCall(channelId);
      setIsOpen(false);
      reset();
    } catch (err) {
      console.error('Failed to start call', err);
      toast.failure('Failed to start call');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <Show
        when={props.inline}
        fallback={<NewMeetingButton onChannelCall={() => setIsOpen(true)} />}
      >
        <div class="flex min-w-0 items-center gap-2 rounded-xl border border-edge-muted bg-panel p-2 pl-3">
          <UserPlusIcon class="size-5 shrink-0 text-ink-muted" />
          <div class="min-w-0 flex-1">
            <RecipientSelector<'user' | 'contact' | 'channel'>
              options={destinationOptions}
              selectedOptions={selectedOptions()}
              setSelectedOptions={setSelectedOptions}
              placeholder="Start a call: add people by name or email…"
              triedToSubmit={triedToSubmit}
              triggerMode="input"
              hideBorder
              noPadding
              disabled={isSubmitting()}
              class="bg-transparent text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0 rounded-lg"
            disabled={isSubmitting() || selectedOptions().length === 0}
            onClick={() => void handleStartCall()}
          >
            <VideoCameraIcon class="size-4" />
            {isSubmitting() ? 'Calling…' : 'Call'}
          </Button>
        </div>
      </Show>
      <Dialog
        open={isOpen()}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) reset();
        }}
        class="w-lg"
      >
        <Surface depth={2} class="rounded-xl">
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
                    variant="outline"
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

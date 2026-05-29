import CloseIcon from '@phosphor/x.svg';
import { Button, Dialog } from '@ui';
import { createSignal, Show } from 'solid-js';
import InteractiveOnboarding from './InteractiveOnboarding';

interface InteractiveOnboardingModalProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function InteractiveOnboardingModal(
  props: InteractiveOnboardingModalProps
) {
  const [internalOpen, setInternalOpen] = createSignal(
    props.defaultOpen ?? false
  );

  const open = () => props.open ?? internalOpen();

  const setOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };

  return (
    <Dialog
      open={open()}
      onOpenChange={setOpen}
      position="center"
      class="w-[min(1600px,calc(100vw-32px))] h-[min(900px,calc(100vh-32px))] max-w-none rounded-xl bg-surface shadow-2xl"
    >
      <div class="relative size-full overflow-hidden rounded-xl">
        <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
          <CloseIcon class="size-4" />
        </Dialog.CloseButton>

        <Show when={open()}>
          <InteractiveOnboarding />
        </Show>
      </div>
    </Dialog>
  );
}

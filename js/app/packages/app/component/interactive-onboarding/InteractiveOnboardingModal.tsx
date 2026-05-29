import MacroIcon from '@icon/macro-logo.svg';
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
      class="w-[min(1400px,calc(100vw-32px))] h-[min(800px,calc(100vh-32px))] max-w-none rounded-xl bg-surface"
    >
      <div class="relative size-full overflow-hidden rounded-xl flex flex-col">
        <header class="shrink-0 flex items-center justify-between gap-4 px-5 py-4">
          <div class="flex gap-4 items-center">
            <MacroIcon class="size-8 text-accent" />
            <div class="min-w-0">
              <Dialog.Title as="h2" class="text-lg font-semibold text-ink m-0">
                Welcome to Macro
              </Dialog.Title>
              <Dialog.Description as="p" class="text-xs text-ink-extra-muted">
                Learn the essentials in a few quick steps.
              </Dialog.Description>
            </div>
          </div>
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            class="self-start"
          >
            <CloseIcon class="size-4" />
          </Dialog.CloseButton>
        </header>

        <div class="flex-1 min-h-0">
          <Show when={open()}>
            <InteractiveOnboarding
              // onDismiss={() => setOpen(false)}
              ignoreTutorialCompleted
            />
          </Show>
        </div>
      </div>
    </Dialog>
  );
}

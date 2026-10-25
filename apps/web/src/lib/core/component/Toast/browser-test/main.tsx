import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Popover } from '@kobalte/core/popover';
import { Button, Dialog } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import '../../../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

function Fixture() {
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [fullscreenOpen, setFullscreenOpen] = createSignal(false);
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [composerInBackground, setComposerInBackground] = createSignal(false);
  const [composerInert, setComposerInert] = createSignal(false);

  onMount(() => {
    toast.custom(
      {
        title: 'Enable Browser Notifications',
        content: () => <div>Get notified about new messages.</div>,
        actions: [{ label: 'Hide', onClick: () => {} }],
      },
      {
        persistent: true,
        region: isMobile() ? 'mobile-prompt-region' : 'prompt-region',
      }
    );
  });

  return (
    <main class="flex min-h-screen flex-col items-start gap-2 bg-page p-4 text-ink">
      <Popover>
        <Popover.Trigger as={Button} variant="outline">
          Open popover
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="menu-surface p-3">
            <Popover.Title>Event details</Popover.Title>
            <Popover.CloseButton
              as={Button}
              aria-label="Close popover"
              variant="outline"
            >
              Close popover
            </Popover.CloseButton>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
      <Button variant="outline" onClick={() => setDialogOpen(true)}>
        Open dialog
      </Button>
      <Button variant="outline" onClick={() => setFullscreenOpen(true)}>
        Open full-screen dialog
      </Button>
      <Button variant="outline" onClick={() => setComposerOpen((v) => !v)}>
        Toggle composer
      </Button>
      <Button
        variant="outline"
        onClick={() => setComposerInBackground((v) => !v)}
      >
        Toggle composer background
      </Button>
      <Button variant="outline" onClick={() => setComposerInert((v) => !v)}>
        Toggle composer inert
      </Button>
      <Dialog open={dialogOpen()} onOpenChange={setDialogOpen}>
        <Dialog.Title>Delete event</Dialog.Title>
        <Button variant="outline" onClick={() => setDialogOpen(false)}>
          Close dialog
        </Button>
      </Dialog>
      <Dialog
        fullscreen
        open={fullscreenOpen()}
        onOpenChange={setFullscreenOpen}
      >
        <Dialog.Title>Reply composer</Dialog.Title>
        <Button variant="outline" onClick={() => setFullscreenOpen(false)}>
          Close full-screen dialog
        </Button>
      </Dialog>
      <Show when={composerOpen()}>
        <div inert={composerInBackground()}>
          <section
            data-holds-prompts
            inert={composerInert()}
            aria-label="Composer"
          >
            Draft
          </section>
        </div>
      </Show>
      <ToastRegion />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(() => <Fixture />, root);

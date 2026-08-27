import { isPlatform } from '@core/util/platform';
import { makePersisted } from '@solid-primitives/storage';
import { Button, Dialog, Surface } from '@ui';
import { createResource, createSignal, Show } from 'solid-js';
import { isIpad } from './isIpad';

const DEBUG_FORCE_OPEN = false;

/**
 * Survives relaunches, so the notice is shown once per device and never again.
 * Module scope so the stored value is read once rather than on every mount.
 */
const [dismissed, setDismissed] = makePersisted(createSignal(false), {
  name: 'ipad-unsupported-notice-dismissed',
});

/**
 * Soft notice shown to iPad users of the native app.
 *
 * The UI is designed for iPhone, and an iPad additionally falls outside
 * `isMobile()` (which is width-based), so it gets served the desktop layout
 * inside an iPhone-tuned shell. This sets expectations rather than blocking
 * anything.
 *
 * Shown once per device: dismissal is persisted to localStorage, so it never
 * returns after the user acknowledges it. `DEBUG_FORCE_OPEN` bypasses the
 * stored flag so the dialog can still be re-tested after dismissing it.
 */
export function IpadUnsupportedDialog() {
  if (!isPlatform('ios') && !DEBUG_FORCE_OPEN) return null;

  const [onIpad] = createResource(isIpad);

  return (
    <Show when={DEBUG_FORCE_OPEN || (onIpad() && !dismissed())}>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setDismissed(true);
        }}
        class="w-[90%] max-w-120"
        position="center"
      >
        <Surface depth={2}>
          <div class="flex flex-col gap-4 px-4 py-5">
            <div class="flex flex-col gap-2">
              <Dialog.Title class="text-lg font-semibold text-ink">
                Optimized for iPhone
              </Dialog.Title>
              <Dialog.Description class="text-sm leading-5 text-ink-extra-muted">
                The Macro iOS app is currently built for iPhone. Some parts of
                the app may feel off on iPad. Full iPad support coming soon.
              </Dialog.Description>
            </div>
            <div class="flex justify-end">
              <Dialog.CloseButton as={Button} variant="accent" size="sm">
                Got it
              </Dialog.CloseButton>
            </div>
          </div>
        </Surface>
      </Dialog>
    </Show>
  );
}

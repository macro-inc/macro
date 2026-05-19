import { logger } from '@observability';
import ResetIcon from '@phosphor/arrow-clockwise.svg';
import HomeIcon from '@phosphor/house.svg';
import { Button, Dialog, Surface } from '@ui';
import { Show } from 'solid-js';

interface FatalErrorProps {
  error?: Error;
  reset?: () => void;
}

export function FatalError(props: FatalErrorProps) {
  logger.error(props.error || 'Unknown error', {
    url: window.location.href,
  });

  return (
    <Dialog open position="center" class="w-120">
      <Surface active depth={2} class="rounded-xl">
        <div class="p-6 sm:p-8 font-sans">
          <div class="text-center">
            <h1 class="text-ink text-lg/7 font-semibold mb-4">
              Something went terribly wrong
            </h1>

            <Show when={props.error} keyed>
              {(error) => (
                <div class="mb-6 p-3 bg-failure/10 border border-edge rounded text-left">
                  <p class="text-sm text-failure-ink font-mono break-all">
                    {error.message || error.toString()}
                  </p>
                </div>
              )}
            </Show>

            <p class="text-ink-muted text-sm mb-6">
              We apologize for the inconvenience. Please try again or contact
              support.
            </p>

            <div class="flex flex-row gap-3 justify-center">
              <Button
                variant="active"
                onClick={() => {
                  window.location.href = window.location.origin + '/app';
                }}
              >
                <HomeIcon class="size-4" /> Home
              </Button>
              <Button variant="base" onClick={props.reset}>
                <ResetIcon class="size-4" /> Try Again
              </Button>
            </div>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}

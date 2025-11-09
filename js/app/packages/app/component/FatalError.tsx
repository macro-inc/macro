import { TextButton } from '@core/component/TextButton';
import ResetIcon from '@icon/regular/arrow-clockwise.svg';
import HomeIcon from '@icon/regular/house.svg';
import { logger } from '@observability';
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
    <div class="min-h-screen flex items-center justify-center bg-panel">
      <div class="max-w-md w-full p-8 bg-panel rounded-xl shadow-lg shadow-edge/30">
        <div class="text-center">
          <h1 class="text-2xl font-bold text-failure mb-4">
            Something went terribly wrong
          </h1>

          <Show when={props.error} keyed>
            {(error) => (
              <div class="mb-6 p-4 bg-failure/10 rounded text-left">
                <p class="text-sm text-failure font-mono break-all">
                  {error.message || error.toString()}
                </p>
              </div>
            )}
          </Show>

          <p class="text-ink mb-6">
            We apologize for the inconvenience. Please try again or contact
            support.
          </p>

          <div class="flex flex-row gap-4 justify-center">
            <TextButton
              theme="accent"
              onClick={() => {
                window.location.href = window.location.origin + '/app';
              }}
              text="Home"
              icon={HomeIcon}
            />
            <TextButton
              theme="base"
              onClick={props.reset}
              text="Try Again"
              icon={ResetIcon}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import ResetIcon from '@icon/regular/arrow-clockwise.svg';
import HomeIcon from '@icon/regular/house.svg';
import { logger } from '@observability';
import { Show } from 'solid-js';
import { Dialog, Panel } from '@ui';

interface FatalErrorProps {
  error?: Error;
  reset?: () => void;
}

export function FatalError(props: FatalErrorProps) {
  logger.error(props.error || 'Unknown error', {
    url: window.location.href,
  });

  return (
    <Dialog open position="center" class="w-[480px]">
      <Panel active depth={2}>
        <div class="p-6 sm:p-8 font-sans">
          <div class="text-center">
            <h1 class="text-ink text-lg font-semibold leading-7 mb-4">
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
              <DeprecatedTextButton
                theme="accent"
                onClick={() => {
                  window.location.href = window.location.origin + '/app';
                }}
                text="Home"
                icon={HomeIcon}
              />
              <DeprecatedTextButton
                theme="base"
                onClick={props.reset}
                text="Try Again"
                icon={ResetIcon}
              />
            </div>
          </div>
        </div>
      </Panel>
    </Dialog>
  );
}

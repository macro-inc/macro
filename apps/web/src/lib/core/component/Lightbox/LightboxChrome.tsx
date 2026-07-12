import * as stackingContext from '@core/constant/stackingContext';
import { isMobile } from '@core/mobile/isMobile';
import ChevronLeftIcon from '@phosphor/caret-left.svg';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { type Accessor, Show } from 'solid-js';

type LightboxChromeProps = {
  // Gallery navigation — a direction is disabled when its handler is omitted.
  onPrevious?: () => void;
  onNext?: () => void;
  navigationHidden?: boolean;
  // "2/5" style indicator — rendered when provided.
  indexLabel?: Accessor<string>;
};

const navButtonClass =
  'absolute top-1/2 -translate-y-1/2 bg-surface backdrop-blur-sm rounded-lg border border-edge p-2 shadow-md hover:bg-surface transition-opacity duration-300 disabled:cursor-not-allowed disabled:opacity-50';

/** Desktop navigation arrows and the image-position indicator. */
export function LightboxChrome(props: LightboxChromeProps) {
  return (
    <>
      {/* Nav arrows — desktop only */}
      <Show when={!isMobile()}>
        <Show when={!props.navigationHidden}>
          <button
            class={cn(navButtonClass, 'left-4')}
            style={{ 'z-index': stackingContext.zModal + 1 }}
            onClick={props.onPrevious}
            disabled={!props.onPrevious}
            aria-label="Previous image"
          >
            <ChevronLeftIcon class="size-5 text-ink" />
          </button>

          <button
            class={cn(navButtonClass, 'right-4')}
            style={{ 'z-index': stackingContext.zModal + 1 }}
            onClick={props.onNext}
            disabled={!props.onNext}
            aria-label="Next image"
          >
            <ChevronRightIcon class="size-5 text-ink" />
          </button>
        </Show>
      </Show>

      {/* Index indicator */}
      <Show when={props.indexLabel}>
        <div
          class="absolute top-4 left-4 bg-surface backdrop-blur-sm rounded-lg border border-edge px-3 py-1.5 shadow-md transition-opacity duration-300"
          style={{ 'z-index': stackingContext.zModal + 1 }}
        >
          <span class="text-sm text-ink font-medium">
            {props.indexLabel?.()}
          </span>
        </div>
      </Show>
    </>
  );
}

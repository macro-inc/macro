import StopIcon from '@phosphor-icons/core/bold/stop-bold.svg?component-solid';
import ArrowFatLineUp from '@phosphor-icons/core/fill/arrow-fat-line-up-fill.svg?component-solid';
import type { Accessor } from 'solid-js';

export function SendMessageButton(props: {
  // not your chat or empty input
  isDisabled: Accessor<boolean>;
  onClick: () => void;
}) {
  return (
    <button
      disabled={props.isDisabled()}
      onClick={() => {
        if (!props.isDisabled()) props.onClick();
      }}
      class="text-ink-muted bg-transparent rounded-full hover:scale-110! transition ease-in-out delay-150 flex flex-col justify-center items-center"
    >
      <div class="bg-transparent rounded-full size-8 flex flex-row justify-center items-center">
        <ArrowFatLineUp
          width={20}
          height={20}
          class="!text-accent-ink !fill-accent"
        />
      </div>
    </button>
  );
}

export function StopButton(props: { onClick: () => void }) {
  return (
    <button onClick={(_) => props.onClick()}>
      <StopIcon class="text-ink-muted hover:scale-110" width={20} height={20} />
    </button>
  );
}

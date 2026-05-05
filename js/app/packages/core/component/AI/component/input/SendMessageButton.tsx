import ArrowUp from '@icon/bold/arrow-up-bold.svg';
import StopIcon from '@phosphor-icons/core/bold/stop-bold.svg?component-solid';
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
      <div class="group hover:bg-accent transition ease-in-out size-6 border border-accent rounded-full flex items-center justify-center">
        <ArrowUp class="group-hover:text-input! group-hover:fill-input! text-accent-ink! fill-accent! size-4 transition ease-in-out" />
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

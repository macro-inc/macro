import PaperPlaneRight from '@icon/fill/paper-plane-right-fill.svg';
import GridLoader from '@macro-icons/macro-grid-noise-loader-4.svg';
import { createSignal, onMount } from 'solid-js';

const defaultPlaceholder = 'Generate with AI...';

export enum AiState {
  // pressing enter causes state transition
  Ready,
  // pressing enter show spinner, transition on event
  Processing,
  // do nothing
  Disabled,
  // loading but can be stopped
  Stopable,
}

export type InlineInputReadyProps = {
  // send message to chat
  sendCallback: (input: string) => void;
  closeInput?: () => void;
  // styling / behavior options
  options?: InlineInputOptions;
};

export type InlineInputOptions = {
  defaultLines?: number;
  placeholderText?: string;
  focusOnMount?: boolean;
  // call close callback if backspace on an empty input
  closeOnEmptyDelete?: boolean;
  setInputRef?: (r: HTMLTextAreaElement) => void;
  keyHandler?: (e: KeyboardEvent) => void;
};

export function InlineInputReady(props: InlineInputReadyProps) {
  const [isFocused, setIsFocused] = createSignal(false);
  const [inputVal, setInputVal] = createSignal('');
  let inputRef: HTMLTextAreaElement | undefined;

  const isEmpty = () => inputVal().trim().length === 0;

  const checkedSend = (): boolean => {
    if (!isFocused || !inputRef || isEmpty()) return false;
    props.sendCallback(inputRef.value);
    return true;
  };

  onMount(() => {
    if (props.options && props.options.focusOnMount && inputRef) {
      setTimeout(() => {
        inputRef.focus();
        setIsFocused(true);
      });
    }
    if (props.options && props.options.setInputRef && inputRef) {
      props.options.setInputRef(inputRef);
    }
  });

  return (
    <div class="relative flex items-end justify-between p-2 ring-1 ring-edge/50 rounded-xs w-full bg-hover">
      <textarea
        class="flex resize-none w-full p-1 text-sm h-max-[800px] overflow-hidden"
        ref={inputRef}
        rows={props?.options?.defaultLines ?? 1}
        onSubmit={(e) => e.preventDefault()}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={props?.options?.placeholderText ?? defaultPlaceholder}
        onInput={(e) => {
          setInputVal(e.currentTarget.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight} px`;
        }}
        onKeyDown={(e) => {
          if (e.key === ' ' && inputRef?.value.length === 0) {
            if (props?.closeInput) props.closeInput();
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            checkedSend();
          }
          if (
            props.options?.closeOnEmptyDelete &&
            e.key === 'Backspace' &&
            isEmpty()
          ) {
            if (props?.closeInput) props.closeInput();
          }
        }}
      />
      <button
        class={`bg-transparent rounded-full ${isEmpty() ? '' : 'hover:scale-110!'} transition ease-in-out delay-150 flex flex-col justify-center items-center py-1`}
        onClick={checkedSend}
      >
        <PaperPlaneRight
          width={20}
          height={20}
          class={`${isEmpty() ? 'text-ink-extra-muted/30 fill-ink-disabled' : 'text-accent-ink !fill-accent'} `}
        />
      </button>
    </div>
  );
}

export type InlineInputLoadingProps = {
  options?: InlineInputOptions;
};

export function InlineInputLoading(props: InlineInputLoadingProps) {
  return (
    <div class="relative flex items-end justify-between p-2 ring-1 ring-edge/50 rounded-xs w-full bg-hover">
      <textarea
        class="flex resize-none rounded-md w-full p-1 text-sm h-max-[800px] overflow-hidden select-none cursor-pointer"
        disabled
        rows={props?.options?.defaultLines ?? 1}
        placeholder={props?.options?.placeholderText ?? defaultPlaceholder}
      />
      <div
        class={`text-ink-muted bg-transparent rounded-full flex flex-col justify-center items-center py-1`}
        onClick={() => {}}
      >
        <GridLoader width={20} height={20} class="text-accent" />
      </div>
    </div>
  );
}

export function InlineInputDisabled(props: InlineInputLoadingProps) {
  return (
    <div class="relative flex items-end justify-between p-2 ring-1 ring-edge/50 rounded-xs w-full bg-hover">
      <textarea
        class="flex resize-none rounded-md w-full p-1 text-sm h-max-[800px] overflow-hidden select-none cursor-pointer"
        disabled
        rows={props?.options?.defaultLines ?? 1}
        placeholder={props?.options?.placeholderText ?? defaultPlaceholder}
      />
      <div
        class={`text-ink-extra-muted bg-transparent rounded-full flex flex-col justify-center items-center py-1`}
        onClick={() => {}}
      >
        <PaperPlaneRight
          width={20}
          height={20}
          class="text-ink-extra-muted/30 fill-ink-extra-muted"
        />
      </div>
    </div>
  );
}

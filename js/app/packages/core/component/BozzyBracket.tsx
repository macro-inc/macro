import { createSignal, type JSX, onMount, type ParentProps } from 'solid-js';

type BozzyBracketProps = {
  style?: JSX.CSSProperties;
  unfocusable?: boolean;
  active: boolean;
  hover?: boolean;
  class?: string;
};

/**
 * Places a highlight and Bozzy Bracket around an active item.
 *
 * @param props.active - Whether to show the highlight and bracket.
 * @param props.class - The class to apply to the highlight wrapper of the component..
 * @returns A JSX element.
 */
export function BozzyBracket(props: ParentProps<BozzyBracketProps>) {
  return (
    <div
      class={`relative group/bozzy w-full h-full hover-transition-bg
        ${props.active && !props.unfocusable ? 'bg-active' : ''}
        ${props.hover && !props.unfocusable ? 'bg-hover' : ''}
        ${props.class}`}
      classList={{
        'bg-active': props.active && !props.unfocusable,
        'bg-hover': props.hover && !props.unfocusable,
      }}
      style={props.style}
    >
      <div
        class="absolute pointer-events-none left-0 top-0 w-full h-full z-modal"
        classList={{
          bracket: (props.active || props.hover) && !props.unfocusable,
          'group-focus-within/bozzy:absolute group-focus-within/bozzy:bracket':
            !props.active && !props.hover && !props.unfocusable,
        }}
      />
      {props.children}
    </div>
  );
}

export function BozzyBracketInnerSibling(props: {
  classList?: Record<string, boolean | undefined>;
  animOnOpen?: boolean;
}) {
  const [big, setBig] = createSignal(props.animOnOpen);
  if (props.animOnOpen) {
    onMount(() => {
      setTimeout(() => setBig(false));
    });
  }
  /* TEST BEFORE REMOVING left-[-1px] top-[-1px] w-[calc(100%+2px)] h-[calc(100%+2px)] */
  return (
    <div
      class="pointer-events-none absolute left-[-1px] top-[-1px] w-[calc(100%+2px)] h-[calc(100%+2px)] bracket-offset-2"
      classList={{
        'transition-transform ease-out duration-100': props.animOnOpen,
        'scale-110': big(),
        'scale-100': !big(),
        ...(props.classList ?? {}),
      }}
    />
  );
}

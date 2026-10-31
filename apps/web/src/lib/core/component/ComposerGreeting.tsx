import MacroIcon from '@icon/macro-logo.svg';
import MacroWireframeIcon from '@icon/macro-logo-wireframe.svg';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/** The shared brand treatment for empty conversation greetings. */
export function ComposerGreeting(props: {
  as?: 'h1' | 'h2';
  wireframe?: boolean;
  children: JSX.Element;
}) {
  return (
    <Dynamic
      component={props.as ?? 'h2'}
      class="m-0 flex items-center justify-center gap-3 font-[Roboto_Slab_Variable] text-[28px] font-[315] light-mode:font-[390] leading-[1.2] tracking-[-0.025em] text-ink light-mode:text-ink/80"
    >
      <span class="grid size-9 shrink-0" aria-hidden="true">
        <MacroIcon
          data-active={!props.wireframe}
          class="greeting-mark col-start-1 row-start-1 size-9 overflow-visible opacity-0 scale-95 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-[active=true]:opacity-100 data-[active=true]:scale-100 motion-reduce:transition-none"
        />
        <MacroWireframeIcon
          data-active={!!props.wireframe}
          class="greeting-mark col-start-1 row-start-1 size-9 overflow-visible opacity-0 scale-95 transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-[active=true]:opacity-100 data-[active=true]:scale-100 motion-reduce:transition-none"
        />
      </span>
      <span class="min-w-0 text-balance">{props.children}</span>
    </Dynamic>
  );
}

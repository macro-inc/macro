import MacroLogo from '@icon/macro-logo.svg';
import type { JSX } from 'solid-js';

export function HomeStartLayout(props: {
  composer: JSX.Element;
  suggestions: JSX.Element;
}) {
  return (
    <div class="size-full overflow-y-auto font-sans">
      <main class="mx-auto flex min-h-full w-full max-w-[816px] flex-col justify-center gap-0 px-6 py-16">
        <header class="mb-8 flex flex-wrap items-center justify-center gap-3 text-center">
          <MacroLogo class="size-9 shrink-0 text-accent" aria-hidden="true" />
          <h1 class="text-[clamp(24px,2.5vw,32px)] font-medium leading-tight tracking-tight text-ink">
            What should we work on?
          </h1>
        </header>
        {props.composer}
        {props.suggestions}
      </main>
    </div>
  );
}

import { Surface } from '@ui';
import type { JSX } from 'solid-js';

export function BotFormSection(props: {
  title: string;
  description: string;
  action?: JSX.Element;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <section class={props.class}>
      <div class="mb-2 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 class="text-sm font-semibold">{props.title}</h2>
          <p class="mt-0.5 text-xs text-ink-muted">{props.description}</p>
        </div>
        {props.action}
      </div>
      <Surface depth={2} class="rounded-xl border border-ink/[0.06] p-4">
        {props.children}
      </Surface>
    </section>
  );
}

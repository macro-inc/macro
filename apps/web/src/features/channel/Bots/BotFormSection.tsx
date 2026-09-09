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
      <div class="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 class="text-sm font-medium">{props.title}</h2>
          <p class="mt-0.5 text-xs text-ink-muted">{props.description}</p>
        </div>
        {props.action}
      </div>
      <div class="rounded-2xl border border-edge-muted bg-ink/2 p-5">
        {props.children}
      </div>
    </section>
  );
}

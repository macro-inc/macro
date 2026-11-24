import { formatLocale } from '@app/lib/i18n';
import { Show } from 'solid-js';

/** Remains below the floating top bar after the bubbles have scrolled away. */
export function PhoneListHeading(props: { title: string; count?: number }) {
  return (
    <header class="sticky top-(--mobile-content-inset-top) z-10 flex shrink-0 items-baseline gap-2 bg-panel px-3 py-3">
      <h1 class="min-w-0 truncate text-[20px]/[26px] font-semibold">
        {props.title}
      </h1>
      <Show when={props.count !== undefined && props.count > 0}>
        <span class="shrink-0 text-[15px]/5 text-ink-extra-muted tabular-nums">
          {props.count?.toLocaleString(formatLocale())}
        </span>
      </Show>
    </header>
  );
}

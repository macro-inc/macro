import { formatLocale } from '@app/lib/i18n';
import { cn } from '@ui/utils/classname';
import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

function Root(props: { title: string; card?: boolean; children: JSX.Element }) {
  return (
    <section
      aria-label={props.title}
      class={cn(
        'relative flex min-w-0 flex-col',
        props.card
          ? 'shrink-0 rounded-[20px] bg-surface-3 py-1'
          : 'min-h-0 flex-1'
      )}
    >
      {props.children}
    </section>
  );
}

function Heading(props: {
  title: string;
  count?: number;
  card?: boolean;
  icon?: JSX.Element;
}) {
  return (
    <header
      class={cn(
        'sticky top-(--mobile-content-inset-top) z-10 flex shrink-0 gap-2 px-3',
        props.card
          ? 'h-9 items-center gap-1.5 rounded-t-[20px] bg-surface-3 text-sm text-ink-muted'
          : 'items-baseline bg-panel py-3'
      )}
    >
      <Show when={props.icon}>
        <span class="flex w-5 shrink-0 justify-center">{props.icon}</span>
      </Show>
      <Dynamic
        component={props.card ? 'h2' : 'h1'}
        class={cn(
          'min-w-0 truncate font-semibold',
          !props.card && 'text-[20px]/[26px]'
        )}
      >
        {props.title}
      </Dynamic>
      <Show when={props.count !== undefined && props.count > 0}>
        <span
          class={cn(
            'shrink-0 font-normal text-ink-extra-muted tabular-nums',
            props.card ? 'text-sm' : 'text-[15px]/5'
          )}
        >
          {props.count?.toLocaleString(formatLocale())}
        </span>
      </Show>
    </header>
  );
}

function Body(props: { children: JSX.Element }) {
  return <div class="flex min-w-0 flex-1 flex-col">{props.children}</div>;
}

/** Keep sticky headings bounded by the section whose rows they describe. */
export const PhoneListSection = { Root, Heading, Body };

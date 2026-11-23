import GlobeIcon from '@icon/system/regular/globe.svg';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { HoverCard } from '@ui';
import { For, Show } from 'solid-js';

/**
 * A company's domains as one read-only header pill, as a contact's Email pill
 * shows its addresses: the first domain and how many more, with every domain
 * in a hover card that focus reaches too.
 */
export function CompanyDomainsPill(props: { domains: string[] }) {
  const others = () => props.domains.length - 1;
  const face = () => (
    <span
      class={propertyPillClasses({
        variant: 'secondary',
        size: 'xs',
        readOnly: true,
        class: 'min-w-0',
      })}
    >
      <GlobeIcon class="size-3 shrink-0" />
      <span class="min-w-0 max-w-60 truncate">{props.domains[0]}</span>
      <Show when={others() > 0}>
        <span class="shrink-0 text-ink-muted">+{others()}</span>
      </Show>
    </span>
  );

  return (
    <Show when={props.domains.length > 0}>
      <Show when={others() > 0} fallback={face()}>
        <HoverCard
          triggerClass="min-w-0 max-w-full"
          placement="bottom-start"
          contentClass="menu-surface p-1.5 px-3"
          content={
            <div class="flex min-w-0 max-w-80 flex-col gap-1 text-sm">
              <span class="text-xs text-ink-muted">Website</span>
              <For each={props.domains}>
                {(domain) => <span class="min-w-0 truncate">{domain}</span>}
              </For>
            </div>
          }
        >
          {face()}
        </HoverCard>
      </Show>
    </Show>
  );
}

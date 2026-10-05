import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import CalendarCheck from '@phosphor/calendar-check.svg';
import Check from '@phosphor/check.svg';
import Warning from '@phosphor/warning.svg';
import { cn, Dropdown } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import type { FormBookingLink } from '../../context/form-context';
import type { FormBookingTarget } from '../../core/form-model';

const sameTarget = (
  left: FormBookingTarget | undefined,
  right: FormBookingTarget
) =>
  left?.profileId === right.profileId && left.eventTypeId === right.eventTypeId;

/** The editor's booking links by owner, in the order they came. */
function byOwner(links: readonly FormBookingLink[]) {
  const groups = new Map<string, FormBookingLink[]>();
  for (const link of links)
    groups.set(link.owner, [...(groups.get(link.owner) ?? []), link]);
  return [...groups].map(([owner, members]) => ({ owner, links: members }));
}

/**
 * Picks one of the editor's own booking links, or sends them to create one.
 * `links` is undefined while they load.
 */
export function BookingLinkMenu(props: {
  links: readonly FormBookingLink[] | undefined;
  failed: boolean;
  selected?: FormBookingTarget;
  trigger: JSX.Element;
  triggerLabel?: string;
  triggerClass?: string;
  triggerVariant: 'outline' | 'ghost';
  disabled?: boolean;
  onChoose: (target: FormBookingTarget) => void;
  onCreate: () => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant={props.triggerVariant}
        size="md"
        class={props.triggerClass}
        aria-label={props.triggerLabel}
        disabled={props.disabled}
      >
        {props.trigger}
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 max-w-[calc(100vw-1rem)]">
        <Switch>
          <Match when={props.failed}>
            <p role="alert" class="px-2 py-1.5 text-xs text-failure-ink">
              Your booking links couldn’t be loaded.
            </p>
          </Match>
          <Match when={!props.links}>
            <p role="status" class="px-2 py-1.5 text-xs text-ink-muted">
              Loading booking links…
            </p>
          </Match>
          <Match when={props.links?.length === 0}>
            <p class="px-2 py-1.5 text-xs text-ink-muted">
              You have no booking links yet. Create one in Calendar settings,
              then come back to add it.
            </p>
          </Match>
          <Match when={props.links}>
            {(links) => (
              <For each={byOwner(links())}>
                {(group) => (
                  <Dropdown.Group>
                    <Dropdown.GroupLabel>{group.owner}</Dropdown.GroupLabel>
                    <For each={group.links}>
                      {(link) => (
                        <Dropdown.Item
                          onSelect={() => props.onChoose(link.target)}
                        >
                          <span class="flex min-w-0 flex-1 flex-col">
                            <Dropdown.ItemLabel class="truncate">
                              {link.title}
                            </Dropdown.ItemLabel>
                            <Dropdown.ItemDescription class="text-xs text-ink-muted">
                              {link.durationMinutes} min
                            </Dropdown.ItemDescription>
                          </span>
                          <Show when={sameTarget(props.selected, link.target)}>
                            <Check class="size-4" aria-label="Current" />
                          </Show>
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                )}
              </For>
            )}
          </Match>
        </Switch>
        <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
        <Dropdown.Item onSelect={props.onCreate}>
          <ArrowSquareOut class="size-4" />
          <span class="flex-1">Create a booking link</span>
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** What a booking step's link reads as on its card. */
export type BookingLinkState =
  | { kind: 'loading' }
  | { kind: 'ready'; title: string; durationMinutes: number; host: string }
  /** Turned off or deleted in Calendar settings. */
  | { kind: 'unavailable' };

/**
 * The booking step: always last, shown to respondents only after their
 * response is saved and has passed every screener.
 */
export function BookingCard(props: {
  sectionId: string;
  title: string;
  description: string;
  link: BookingLinkState;
  /** Chooses another booking link. */
  change: JSX.Element;
  menu: JSX.Element;
  onTitle: (title: string) => void;
  onDescription: (description: string) => void;
}) {
  return (
    <section
      aria-label={props.title || 'Booking'}
      data-form-section={props.sectionId}
      data-section-kind="booking"
      tabIndex={-1}
      class="overflow-hidden rounded-xl border border-edge bg-surface shadow-xs outline-none focus-visible:border-edge-focus"
    >
      <header class="flex items-start gap-1 border-b border-edge-divider px-2 pt-3 pb-2">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 pl-1">
          <div class="flex items-center gap-1.5 px-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            <CalendarCheck class="size-3.5" aria-hidden="true" />
            <span>Booking · last step</span>
          </div>
          <input
            aria-label="Booking step title"
            placeholder="Book a time"
            value={props.title}
            maxlength={200}
            class="h-8 w-full rounded-md border border-transparent bg-transparent px-1.5 text-base font-semibold text-ink outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input"
            onInput={(event) => props.onTitle(event.currentTarget.value)}
          />
          <input
            aria-label="Booking step description"
            placeholder="Description (optional)"
            value={props.description}
            maxlength={2000}
            class="h-7 w-full rounded-md border border-transparent bg-transparent px-1.5 text-xs text-ink-muted outline-none placeholder:text-ink-placeholder hover:border-edge-muted focus:border-edge-focus focus:bg-input"
            onInput={(event) => props.onDescription(event.currentTarget.value)}
          />
        </div>
        {props.menu}
      </header>
      <div class="flex flex-col gap-3 px-4 py-3">
        <div
          class={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2',
            props.link.kind === 'unavailable'
              ? 'border-failure/40 bg-failure-bg'
              : 'border-edge-muted bg-panel'
          )}
        >
          <div class="flex min-w-0 flex-1 items-start gap-2">
            <Switch>
              <Match when={props.link.kind === 'unavailable'}>
                <Warning
                  class="mt-0.5 size-4 shrink-0 text-failure-ink"
                  aria-hidden="true"
                />
                <p role="alert" class="text-sm text-failure-ink">
                  This booking link is turned off or deleted. Respondents can’t
                  book until you choose another.
                </p>
              </Match>
              <Match when={props.link.kind === 'loading'}>
                <p role="status" class="text-sm text-ink-muted">
                  Loading booking link…
                </p>
              </Match>
              <Match
                when={props.link.kind === 'ready' ? props.link : undefined}
              >
                {(ready) => (
                  <>
                    <CalendarCheck
                      class="mt-0.5 size-4 shrink-0 text-ink-muted"
                      aria-hidden="true"
                    />
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate text-sm font-medium text-ink">
                        {ready().title}
                      </span>
                      <span class="truncate text-xs text-ink-muted">
                        {ready().durationMinutes} min · {ready().host}
                      </span>
                    </span>
                  </>
                )}
              </Match>
            </Switch>
          </div>
          {props.change}
        </div>
        <p class="text-[11px] text-ink-muted">
          Respondents see this calendar only after their response is saved and
          passes every screener. Anyone who already has the booking link can
          still book it directly. Removing this step keeps the link and its
          bookings.
        </p>
      </div>
    </section>
  );
}

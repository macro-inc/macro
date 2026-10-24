import { openExternalUrl } from '@core/util/url';
import AddressBookIcon from '@phosphor/address-book.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChartBarIcon from '@phosphor/chart-bar-horizontal.svg';
import CheckIcon from '@phosphor/check.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import { cn } from '@ui';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  type Contacts,
  eventWhen,
  formatCoordinates,
  type Location,
  mapsUrl,
  namesList,
  type Poll,
  type RichContent,
  type WhatsAppEvent,
} from '../core/rich';

function Card(props: {
  kind: string;
  icon: JSX.Element;
  label: string;
  children: JSX.Element;
}) {
  return (
    <div
      class="mt-1 flex w-80 max-w-full flex-col gap-2 rounded-xl border border-edge-muted bg-surface p-3 text-sm"
      data-whatsapp-card={props.kind}
    >
      <div class="flex items-center gap-1.5 text-xs text-ink-muted">
        <span aria-hidden="true" class="flex size-3.5 shrink-0">
          {props.icon}
        </span>
        {props.label}
      </div>
      {props.children}
    </div>
  );
}

function ExternalLink(props: { href: string; children: JSX.Element }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      class="text-accent underline-offset-2 hover:underline"
      onClick={(event) => {
        // Like Chat's links: plain clicks open through the app (Tauri).
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        openExternalUrl(props.href);
      }}
    >
      {props.children}
    </a>
  );
}

/** Tallies only: votes are cast in WhatsApp. */
export function PollCard(props: { poll: Poll }) {
  const most = () =>
    Math.max(1, ...props.poll.options.map((option) => option.votes));
  const total = () =>
    props.poll.options.reduce((sum, option) => sum + option.votes, 0);
  return (
    <Card
      kind="poll"
      icon={<ChartBarIcon class="size-3.5" />}
      label={
        props.poll.selectableCount === 1
          ? 'Poll · Select one'
          : 'Poll · Select one or more'
      }
    >
      <p class="font-medium text-ink wrap-break-word">{props.poll.question}</p>
      <ul class="flex flex-col gap-2">
        <For each={props.poll.options}>
          {(option) => (
            <li
              class="flex flex-col gap-1"
              title={
                option.voters.length ? namesList(option.voters) : undefined
              }
            >
              <div class="flex items-baseline gap-2">
                <span class="flex size-3.5 shrink-0 self-center text-accent">
                  <Show when={option.mine}>
                    <CheckIcon class="size-3.5" aria-label="Your vote" />
                  </Show>
                </span>
                <span class="min-w-0 flex-1 wrap-break-word text-ink">
                  {option.name}
                </span>
                <span class="shrink-0 text-xs tabular-nums text-ink-muted">
                  {option.votes}
                </span>
              </div>
              <div class="ml-5.5 h-1 overflow-hidden rounded-full bg-hover">
                <div
                  class={cn(
                    'h-full rounded-full',
                    option.mine ? 'bg-accent' : 'bg-ink-extra-muted'
                  )}
                  style={{ width: `${(option.votes / most()) * 100}%` }}
                />
              </div>
            </li>
          )}
        </For>
      </ul>
      <p class="text-xs text-ink-muted">
        {total() === 1 ? '1 vote' : `${total()} votes`}
        {props.poll.voters > 0 &&
          ` from ${props.poll.voters === 1 ? '1 person' : `${props.poll.voters} people`}`}{' '}
        · Vote in WhatsApp
      </p>
    </Card>
  );
}

export function LocationCard(props: { location: Location }) {
  return (
    <Card
      kind="location"
      icon={<MapPinIcon class="size-3.5" />}
      label={props.location.live ? 'Live location' : 'Location'}
    >
      <div class="flex flex-col gap-0.5">
        <Show when={props.location.name}>
          {(name) => <p class="font-medium text-ink">{name()}</p>}
        </Show>
        <Show when={props.location.address}>
          {(address) => <p class="text-ink-muted">{address()}</p>}
        </Show>
        <p class="text-xs tabular-nums text-ink-muted">
          {formatCoordinates(props.location)}
        </p>
        <Show when={props.location.comment}>
          {(comment) => <p class="text-ink wrap-break-word">{comment()}</p>}
        </Show>
      </div>
      <div class="flex flex-wrap gap-x-3 text-xs">
        <ExternalLink href={mapsUrl(props.location)}>Open in Maps</ExternalLink>
        <Show when={props.location.url}>
          {(url) => <ExternalLink href={url()}>Open link</ExternalLink>}
        </Show>
      </div>
    </Card>
  );
}

export function ContactsCard(props: { contacts: Contacts }) {
  return (
    <Card
      kind="contacts"
      icon={<AddressBookIcon class="size-3.5" />}
      label={props.contacts.contacts.length === 1 ? 'Contact' : 'Contacts'}
    >
      <ul class="flex flex-col gap-2">
        <For each={props.contacts.contacts}>
          {(contact) => (
            <li class="flex flex-col gap-0.5">
              <span class="font-medium text-ink">{contact.name}</span>
              <For each={contact.phones}>
                {(phone) => (
                  <a
                    href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                    class="text-xs tabular-nums text-ink-muted hover:underline"
                  >
                    {phone}
                  </a>
                )}
              </For>
            </li>
          )}
        </For>
      </ul>
    </Card>
  );
}

export function EventCard(props: { event: WhatsAppEvent }) {
  return (
    <Card
      kind="event"
      icon={<CalendarIcon class="size-3.5" />}
      label={props.event.canceled ? 'Event · Canceled' : 'Event'}
    >
      <div class="flex flex-col gap-0.5">
        <p
          class="font-medium text-ink wrap-break-word"
          classList={{ 'line-through': props.event.canceled }}
        >
          {props.event.name}
        </p>
        <Show when={eventWhen(props.event)}>
          {(when) => <p class="text-ink-muted">{when()}</p>}
        </Show>
        <Show when={props.event.location}>
          {(location) => <p class="text-ink-muted">{location()}</p>}
        </Show>
        <Show when={props.event.description}>
          {(description) => (
            <p class="line-clamp-3 whitespace-pre-wrap text-ink wrap-break-word">
              {description()}
            </p>
          )}
        </Show>
      </div>
      <Show when={!props.event.canceled && props.event.joinLink}>
        {(link) => (
          <div class="text-xs">
            <ExternalLink href={link()}>Join</ExternalLink>
          </div>
        )}
      </Show>
    </Card>
  );
}

/** The card for a message's rich content; system lines render elsewhere. */
export function RichCard(props: { rich: RichContent }) {
  return (
    <Switch>
      <Match when={props.rich.type === 'poll' && props.rich}>
        {(poll) => <PollCard poll={poll()} />}
      </Match>
      <Match when={props.rich.type === 'location' && props.rich}>
        {(location) => <LocationCard location={location()} />}
      </Match>
      <Match when={props.rich.type === 'contacts' && props.rich}>
        {(contacts) => <ContactsCard contacts={contacts()} />}
      </Match>
      <Match when={props.rich.type === 'event' && props.rich}>
        {(event) => <EventCard event={event()} />}
      </Match>
    </Switch>
  );
}

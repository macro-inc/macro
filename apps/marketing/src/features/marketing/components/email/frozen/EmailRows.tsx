import Envelope from '@phosphor/envelope-simple.svg';
import { For, Show } from 'solid-js';
import { homepagePeople } from '../../../core/homepage-demo-people';
import type { DemoEmail } from '../email-fixtures';

// Email-only projection of entity/composed/list-entity/{wide-layout,email,
// narrow-inbox-layout}.tsx. Slot divs retain the app's classes and geometry;
// entity/context/query reads are replaced by fixture props.
export function InboxChip(props: { account: DemoEmail['account'] }) {
  return (
    <img
      class="size-4 shrink-0 rounded-full object-cover"
      src={homepagePeople.jacob.photo}
      alt=""
      title={
        props.account === 'work'
          ? 'jacob@macro.com'
          : 'jacob.beckerman@gmail.com'
      }
    />
  );
}

function WideRow(props: { email: DemoEmail }) {
  return (
    <div class="mail-row-wide w-full min-h-[inherit] items-center text-sm pl-(--soup-row-padding-l) pr-2 gap-y-2 gap-x-(--soup-row-column-gap) grid grid-rows-[1fr] grid-cols-[var(--soup-row-indicator-width)_1fr_8ch] [--title-width:10rem]">
      <span class="relative size-full grid place-items-center">
        <Show when={props.email.unread}>
          <span class="size-1.5 rounded-full bg-accent" />
        </Show>
      </span>
      <div class="font-medium truncate items-center gap-2 flex">
        <Envelope class="size-4 shrink-0 text-ink-muted" />
        <span class="w-(--title-width) shrink-0 flex items-center gap-2">
          <span class="truncate max-w-32 flex gap-2 items-center">
            {props.email.sender}
          </span>
          <span class="ml-auto flex shrink-0 items-center">
            <InboxChip account={props.email.account} />
          </span>
        </span>
        <span class="truncate">{props.email.subject}</span>
        <span class="text-ink/50 font-medium truncate flex-1">
          {props.email.snippet}
        </span>
      </div>
      <span class="text-xs text-right text-ink-extra-muted font-medium">
        {props.email.time}
      </span>
    </div>
  );
}

function NarrowRow(props: { email: DemoEmail }) {
  return (
    <div
      class="mail-row-narrow w-full text-sm grid"
      style={{
        'grid-template-columns': 'auto 1fr 8ch',
        'grid-template-areas': '"icon title timestamp" "icon body body"',
      }}
    >
      <span
        class="flex items-center self-center pr-3"
        style={{ 'grid-area': 'icon' }}
      >
        <span class="mx-[7px] size-[11px] grid place-items-center">
          <Show when={props.email.unread}>
            <span class="size-1.5 rounded-full bg-accent" />
          </Show>
        </span>
        <span class="size-11 bg-edge-muted rounded-full flex items-center justify-center">
          <Envelope class="size-6 text-ink-muted" />
        </span>
      </span>
      <span
        class="flex items-center gap-2 truncate font-semibold pt-3"
        style={{ 'grid-area': 'title' }}
      >
        <span class="truncate min-w-0">{props.email.sender}</span>
        <span class="ml-auto">
          <InboxChip account={props.email.account} />
        </span>
      </span>
      <span
        class="text-xs text-right text-ink-extra-muted font-light pt-3 pr-4"
        style={{ 'grid-area': 'timestamp' }}
      >
        {props.email.time}
      </span>
      <span
        class="flex flex-col pb-2 min-h-[2lh] pr-4"
        style={{ 'grid-area': 'body' }}
      >
        <span class="truncate">{props.email.subject}</span>
        <span class="text-ink/50 font-medium truncate">
          {props.email.snippet}
        </span>
      </span>
    </div>
  );
}

export function EmailRows(props: {
  emails: readonly DemoEmail[];
  onOpen: (email: DemoEmail) => void;
}) {
  return (
    <div class="mail-rows" aria-label="Email messages">
      <For each={['Today', 'Yesterday']}>
        {(day) => (
          <Show
            when={props.emails.some(
              (email) => !!email.yesterday === (day === 'Yesterday')
            )}
          >
            <div class="mail-date-group text-xs text-ink-extra-muted">
              {day}
            </div>
            <For
              each={props.emails.filter(
                (email) => !!email.yesterday === (day === 'Yesterday')
              )}
            >
              {(email) => (
                <button
                  type="button"
                  class="mail-row soup-row-wide rounded-xl relative flex flex-col py-0.5 min-h-10 mx-1 hover:bg-list-hover text-left text-ink"
                  onClick={() => props.onOpen(email)}
                  aria-label={`Read ${email.subject}`}
                >
                  <WideRow email={email} />
                  <NarrowRow email={email} />
                </button>
              )}
            </For>
          </Show>
        )}
      </For>
      <Show when={props.emails.length === 0}>
        <p class="p-8 text-sm text-ink-muted">No matching messages.</p>
      </Show>
    </div>
  );
}

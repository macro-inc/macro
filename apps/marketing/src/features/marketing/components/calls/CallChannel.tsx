import ChatText from '@phosphor/chat-text.svg';
import FileIcon from '@phosphor/file.svg';
import Hash from '@phosphor/hash.svg';
import Paperclip from '@phosphor/paperclip.svg';
import Phone from '@phosphor/phone.svg';
import PhoneCall from '@phosphor/phone-call.svg';
import Sparkle from '@phosphor/sparkle.svg';
import UserPlus from '@phosphor/user-plus.svg';
import Users from '@phosphor/users.svg';
import { Button } from '@ui';
import { TabsInset } from '@ui/components/TabsInset';
import {
  type Component,
  createEffect,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { SearchBar } from '../email/frozen/SearchBar';
import { MessageRow } from '../workspace/frozen/MessageRow';
import type { CallPerson } from './call-fixtures';

export type ChannelTab =
  | 'messages'
  | 'attachments'
  | 'calls'
  | 'participants'
  | 'call';

const TABS: {
  value: ChannelTab;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}[] = [
  { value: 'messages', label: 'Messages', icon: ChatText },
  { value: 'attachments', label: 'Attachments', icon: Paperclip },
  { value: 'calls', label: 'Calls', icon: Phone },
  { value: 'participants', label: 'Participants', icon: Users },
  { value: 'call', label: 'Call', icon: PhoneCall },
];

/**
 * ChannelDetailTopBar: title, inset tabs (icons when the bar runs out of
 * room), then Invite, Call or Join, and Ask Macro. The live Call tab shows
 * while a call runs in the channel.
 */
export function ChannelTopBar(props: {
  tab: ChannelTab;
  onTab: (tab: ChannelTab) => void;
  live: boolean;
  /** Hidden while you are in this channel's call. */
  callButton?: 'call' | 'join';
  onCall?: () => void;
}) {
  const tabs = () =>
    TABS.filter((tab) => tab.value !== 'call' || props.live).map((tab) => ({
      value: tab.value,
      label: (
        <span class="call-tab" data-channel-tab={tab.value}>
          <tab.icon class="call-tab-icon size-4" aria-hidden="true" />
          <span class="call-tab-text">
            <Show when={tab.value === 'call'}>
              <span class="size-1.5 animate-pulse rounded-full bg-success" />
            </Show>
            {tab.label}
          </span>
        </span>
      ),
    }));
  return (
    <ViewShell.TopBar class="call-bar call-channel-bar gap-3 py-0">
      <div class="flex min-w-0 shrink items-center gap-2">
        <Hash class="size-4 shrink-0" />
        <span class="truncate text-sm font-semibold">launch</span>
      </div>
      <TabsInset
        class="call-channel-tabs shrink-0"
        aria-label="Channel view"
        list={tabs()}
        value={props.tab}
        onChange={(value) => props.onTab(value as ChannelTab)}
      />
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <Button
          variant="plain"
          size="md"
          tooltip="Invite people"
          class="call-bar-action call-bar-invite"
        >
          <UserPlus />
          <span class="call-bar-label">Invite</span>
        </Button>
        <Show when={props.callButton}>
          {(kind) => (
            <Button
              variant="plain"
              size="md"
              aria-label={kind() === 'join' ? 'Join' : 'Call'}
              tooltip={kind() === 'join' ? 'Join Call' : 'Start Call'}
              class={
                kind() === 'join'
                  ? 'call-bar-action text-success'
                  : 'call-bar-action'
              }
              data-channel-call
              onClick={() => props.onCall?.()}
            >
              <PhoneCall />
              <span class="call-bar-label">
                {kind() === 'join' ? 'Join' : 'Call'}
              </span>
            </Button>
          )}
        </Show>
        <Button
          variant="plain"
          size="md"
          tooltip="Ask Macro"
          class="call-bar-action"
        >
          <Sparkle />
          <span class="call-bar-label">Ask Macro</span>
        </Button>
      </div>
    </ViewShell.TopBar>
  );
}

/** ActiveCallMessage, above the composer while you are not in the call. */
export function ActiveCallBanner(props: {
  duration: string;
  onJoin?: () => void;
}) {
  return (
    <div class="call-banner" data-active-call>
      <div class="call-banner-grid">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <PhoneCall class="size-5" />
        </div>
        <div class="min-w-0 rounded-md border border-edge-muted bg-surface px-3 py-2 text-sm text-ink">
          <div class="flex min-w-0 items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-medium">A call is active in this channel</div>
              <div class="text-xs text-ink-extra-muted">
                Active for{' '}
                <span class="font-mono tabular-nums">{props.duration}</span>
              </div>
            </div>
            <Button
              variant="success"
              size="sm"
              class="shrink-0"
              onClick={() => props.onJoin?.()}
            >
              <PhoneCall class="size-3.5" />
              Join
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Channel timeline anchored to the composer, as ThreadList is. */
export function ChannelMessages(props: {
  messages: WorkspaceComment[];
  banner?: JSX.Element;
  onSend: (body: string) => void;
}) {
  let log!: HTMLDivElement;
  // ThreadList keeps the newest message above the composer until you scroll up.
  let pinned = true;
  const pin = () => {
    if (pinned) log.scrollTop = log.scrollHeight;
  };
  onMount(() => {
    pin();
    const resize = new ResizeObserver(pin);
    resize.observe(log);
    onCleanup(() => resize.disconnect());
  });
  createEffect(
    on(
      () => props.messages.length,
      () => {
        pinned = true;
        queueMicrotask(pin);
      },
      { defer: true }
    )
  );
  return (
    <>
      <div
        ref={log}
        class="dummy-scroll call-channel-log"
        role="log"
        aria-label="Channel launch"
        onScroll={() => {
          pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
        }}
      >
        <div class="sample-chat-log">
          <div class="sample-date-divider">
            <span>Today</span>
          </div>
          <For each={props.messages}>
            {(message) => (
              <MessageRow message={message}>
                <Show when={message.documentId}>
                  <span class="dummy-entity-link">
                    <FileIcon class="size-4 text-note" />
                    Q3 launch plan
                  </span>
                </Show>
              </MessageRow>
            )}
          </For>
        </div>
      </div>
      {props.banner}
      <div class="dummy-composer sample-chat-composer">
        <ChannelComposer
          richMentions
          label="Message #launch"
          placeholder="Type @ to share with #launch"
          onSend={props.onSend}
        />
      </div>
    </>
  );
}

export type CallListRow = {
  id: string;
  title: string;
  summary: string;
  status: 'attended' | 'missed';
  duration: string;
  people: CallPerson[];
  time: string;
};

function Badge(props: { class?: string; children: JSX.Element }) {
  return (
    <span
      class={`flex select-none items-center gap-1 rounded-full border border-edge-muted p-0.5 px-2 font-mono text-xxs font-medium ${props.class ?? ''}`}
    >
      {props.children}
    </span>
  );
}

/** ChannelCallsTab: "Search calls" and ListEntity wide call rows. */
export function ChannelCallsList(props: {
  rows: CallListRow[];
  fresh?: string;
  search: string;
  onSearch: (value: string) => void;
  onOpen: (id: string) => void;
}) {
  const rows = () => {
    const query = props.search.trim().toLowerCase();
    return query.length < 3
      ? props.rows
      : props.rows.filter((row) =>
          `${row.title} ${row.summary}`.toLowerCase().includes(query)
        );
  };
  return (
    <div class="call-calls-tab">
      <div class="call-calls-width">
        <div class="shrink-0 pb-2">
          <SearchBar
            label="Search calls"
            placeholder="Search calls"
            value={props.search}
            onValueChange={props.onSearch}
          />
        </div>
        <div role="grid" aria-label="Calls" class="call-calls-grid">
          <For each={rows()}>
            {(row) => (
              <div role="row">
                <button
                  type="button"
                  role="gridcell"
                  class="call-list-row"
                  data-call-row={row.id}
                  data-fresh={props.fresh === row.id ? 'true' : undefined}
                  onClick={() => props.onOpen(row.id)}
                >
                  <PhoneCall class="call-list-icon size-4 shrink-0" />
                  <span class="call-list-title truncate font-medium">
                    {row.title}
                  </span>
                  <Badge class="call-list-channel normal-case font-sans text-ink-extra-muted">
                    <Hash class="size-3 shrink-0" />
                    launch
                  </Badge>
                  <span class="call-list-summary">{row.summary}</span>
                  <span class="call-list-meta">
                    <Badge
                      class={
                        row.status === 'missed'
                          ? 'call-list-status uppercase text-warning'
                          : 'call-list-status uppercase text-ink-extra-muted'
                      }
                    >
                      {row.status}
                    </Badge>
                    <Badge class="normal-case text-ink-extra-muted">
                      {row.duration}
                    </Badge>
                    <span class="call-list-people">
                      <For each={row.people.slice(0, 2)}>
                        {(person) => (
                          <img
                            src={homepagePeople[person].photo}
                            alt={homepagePeople[person].name}
                          />
                        )}
                      </For>
                      <Show when={row.people.length > 2}>
                        <span>+{row.people.length - 2}</span>
                      </Show>
                    </span>
                  </span>
                  <span class="call-list-time">{row.time}</span>
                </button>
              </div>
            )}
          </For>
          <Show when={!rows().length}>
            <p class="py-10 text-center text-sm text-ink-muted">
              No results for "{props.search.trim()}"
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
}

const firstNames = (people: CallPerson[]) => {
  const names = people.map((person) => homepagePeople[person].shortName);
  if (names.length === 1) return `${names[0]} is in this call.`;
  if (names.length === 2)
    return `${names[0]} and ${names[1]} are in this call.`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]}, and ${rest} other${rest === 1 ? '' : 's'} are in this call.`;
};

/** ChannelCallTab's JoinCallEmptyState. */
export function JoinCallEmptyState(props: {
  people: CallPerson[];
  onJoin: () => void;
}) {
  return (
    <div class="flex size-full flex-col items-center justify-center gap-5 px-6 text-center text-ink">
      <div class="flex flex-col items-center gap-3">
        <div class="call-avatar-group">
          <For each={props.people}>
            {(person) => <img src={homepagePeople[person].photo} alt="" />}
          </For>
        </div>
        <div class="flex flex-col items-center gap-1">
          <h2 class="text-lg font-semibold">Call in progress</h2>
          <p class="max-w-sm text-sm text-ink-muted">
            {firstNames(props.people)}
          </p>
        </div>
      </div>
      <Button
        variant="cta"
        size="lg"
        class="px-5"
        onClick={() => props.onJoin()}
      >
        <PhoneCall class="size-5" />
        Join call
      </Button>
    </div>
  );
}

/** ChannelParticipantsTab rows. */
export function ChannelParticipants(props: { people: CallPerson[] }) {
  return (
    <div class="dummy-scroll call-participants">
      <For each={props.people}>
        {(person) => (
          <div class="flex items-center gap-3 py-2.5 text-sm">
            <img
              class="size-8 rounded-full object-cover"
              src={homepagePeople[person].photo}
              alt=""
            />
            <span class="flex min-w-0 flex-col">
              <span class="truncate font-medium">
                {homepagePeople[person].name}
              </span>
              <span class="truncate text-xs text-ink-muted">
                {person}@macro.com
              </span>
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

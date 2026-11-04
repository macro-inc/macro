import { SidePanel } from '@components/app/side-panel';
import { EntityMetadata } from '@components/app/side-panel/EntityMetadata';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Badge, Button, ConfirmDialog, InputGroup } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { phoneFromJid } from '../../whatsapp-linked/core/account';
import type { ChatDetail } from '../core/chat';
import { providerIdentity } from '../providers/identity';

/** Member lists longer than this get a filter above the list. */
const FILTER_FROM = 12;

type Member = ChatDetail['members'][number];

function initials(name: string): string {
  const letters = name
    .replace(/^\+/, '')
    .split(/\s+/)
    .map((word) => word[0])
    .filter((letter) => !!letter && /\p{L}/u.test(letter));
  return (letters.slice(0, 2).join('') || '#').toUpperCase();
}

function MemberRow(props: { member: Member; own: boolean }) {
  const phone = () => phoneFromJid(props.member.id);
  return (
    <li class="flex min-h-9 items-center gap-2 px-1" data-chat-member>
      <span
        aria-hidden="true"
        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-hover text-[10px] font-medium text-ink-muted"
      >
        {initials(props.member.name)}
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="ph-no-capture truncate text-sm text-ink">
          {props.member.name}
          <Show when={props.own}>
            <span class="text-ink-extra-muted"> (you)</span>
          </Show>
        </span>
        <Show when={phone() !== props.member.name && phone()}>
          {(number) => (
            <span class="ph-no-capture truncate text-xs text-ink-extra-muted">
              {number()}
            </span>
          )}
        </Show>
      </div>
      <Show when={props.member.admin}>
        <Badge variant="outline" size="xs">
          Admin
        </Badge>
      </Show>
    </li>
  );
}

/** The group's participants at its provider: name, number, admin. */
function Members(props: { chat: ChatDetail }) {
  const label = () => providerIdentity(props.chat.provider).label;
  const [filter, setFilter] = createSignal('');
  const ownDigits = () => props.chat.phone?.replace(/\D/g, '');
  const isOwn = (member: Member) =>
    !!ownDigits() &&
    phoneFromJid(member.id)?.replace(/\D/g, '') === ownDigits();
  const sorted = createMemo(() =>
    [...props.chat.members].sort(
      (a, b) =>
        Number(isOwn(b)) - Number(isOwn(a)) ||
        Number(b.admin) - Number(a.admin) ||
        a.name.localeCompare(b.name)
    )
  );
  const shown = createMemo(() => {
    const query = filter().trim().toLowerCase();
    if (!query) return sorted();
    const digits = query.replace(/\D/g, '');
    return sorted().filter(
      (member) =>
        member.name.toLowerCase().includes(query) ||
        (!!digits && (phoneFromJid(member.id) ?? '').includes(digits))
    );
  });
  return (
    <div class="flex flex-col gap-2">
      <p class="px-1 text-xs text-ink-muted">
        Members of the {label()} group can send from Macro with their own{' '}
        {label()}.
      </p>
      <Show when={props.chat.members.length > FILTER_FROM}>
        <InputGroup size="md" variant="outline" class="rounded-full">
          <InputGroup.Addon>
            <MagnifyingGlassIcon />
          </InputGroup.Addon>
          <InputGroup.Input
            type="search"
            value={filter()}
            onInput={(event) => setFilter(event.currentTarget.value)}
            placeholder="Search members"
            aria-label="Search members"
          />
        </InputGroup>
      </Show>
      <ul aria-label={`${label()} members`} class="flex flex-col">
        <For
          each={shown()}
          fallback={
            <li class="px-1 py-2 text-xs text-ink-muted">
              No matching members
            </li>
          }
        >
          {(member) => <MemberRow member={member} own={isOwn(member)} />}
        </For>
      </ul>
    </div>
  );
}

/**
 * The chat's side panel sections: its provider members, Macro sharing and,
 * for the owner, syncing. Registers with the nearest `SidePanel.Root`.
 */
export function ChatDetails(props: {
  chat: ChatDetail;
  stopped: boolean;
  onShare: () => void;
  /** Stops syncing; false when it failed (the caller reported why). */
  onStopSync: () => Promise<boolean>;
}) {
  const label = () => providerIdentity(props.chat.provider).label;
  const [confirming, setConfirming] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const stop = async () => {
    setStopping(true);
    const stopped = await props.onStopSync();
    setStopping(false);
    if (stopped) setConfirming(false);
  };
  return (
    <>
      <Show when={props.chat.kind !== 'direct'}>
        <SidePanel.Section
          id="chat-members"
          title={
            <SidePanel.CountTitle
              label="Members"
              count={props.chat.members.length}
            />
          }
          defaultOpen
          order={10}
        >
          <Members chat={props.chat} />
        </SidePanel.Section>
      </Show>
      <SidePanel.Section
        id="chat-sharing"
        title="Sharing"
        defaultOpen
        order={20}
      >
        <div class="flex flex-col items-start gap-2 px-1">
          <p class="text-xs text-ink-muted">
            People you share this chat with read it in Macro.{' '}
            {props.chat.kind === 'direct'
              ? 'Only its owner can reply.'
              : `Only ${label()} members can send.`}
          </p>
          <Button variant="secondary" size="sm" onClick={() => props.onShare()}>
            Share…
          </Button>
        </div>
      </SidePanel.Section>
      <Show when={props.chat.accessLevel === 'owner'}>
        <SidePanel.Section
          id="chat-sync"
          title="Syncing"
          defaultOpen
          order={30}
        >
          <div class="flex flex-col items-start gap-2 px-1">
            <p class="text-xs text-ink-muted" role="status">
              <Show
                when={!props.stopped}
                fallback="Syncing stopped. Its history stays in Macro."
              >
                <Show
                  when={props.chat.phone}
                  fallback={`New messages sync from your ${label()}.`}
                >
                  {(phone) => (
                    <>
                      New messages sync from your {label()},{' '}
                      <span class="ph-no-capture">{phone()}</span>.
                    </>
                  )}
                </Show>
              </Show>
            </p>
            <Show when={!props.stopped}>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirming(true)}
              >
                Stop syncing
              </Button>
            </Show>
            {/* Inside the panel, so on touch it stacks on the details sheet. */}
            <ConfirmDialog
              open={confirming()}
              onOpenChange={setConfirming}
              title="Stop syncing this chat?"
              body="Its history stays in Macro. New messages will stop syncing."
              confirmLabel="Stop syncing"
              tone="danger"
              pending={stopping()}
              onConfirm={stop}
            />
          </div>
        </SidePanel.Section>
      </Show>
      <SidePanel.Footer>
        <EntityMetadata ownerId={props.chat.ownerId} />
      </SidePanel.Footer>
    </>
  );
}

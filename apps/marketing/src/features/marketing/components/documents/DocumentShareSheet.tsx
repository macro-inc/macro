import CaretDown from '@phosphor/caret-down.svg';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import Eye from '@phosphor/eye.svg';
import FileText from '@phosphor/file-text.svg';
import Hash from '@phosphor/hash-straight.svg';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import Pencil from '@phosphor/pencil.svg';
import UserCircle from '@phosphor/user-circle.svg';
import Users from '@phosphor/users.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import {
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';

/** GroupChannelLabel for #launch: its other members, up to 20 characters. */
export const LAUNCH_MEMBERS = 'Julia, Teo, Gabriel +1 other';

export type ShareLevel = 'view' | 'comment' | 'edit';
type Level = ShareLevel;
export type DocumentShareHandle = {
  typeRecipient: (text: string) => void;
  typeMessage: (text: string) => void;
  selectChannel: () => void;
  share: () => void;
  reset: () => void;
};
const LEVELS: { value: Level; label: string; icon: typeof Eye }[] = [
  { value: 'view', label: 'View', icon: Eye },
  { value: 'comment', label: 'Comment', icon: ChatTeardrop },
  { value: 'edit', label: 'Edit', icon: Pencil },
];

/** ShareOptions: the current level's icon and label over a native picker. */
function AccessLevel(props: {
  label: string;
  value: Level;
  onChange: (value: Level) => void;
  borderless?: boolean;
}) {
  const current = () =>
    LEVELS.find((level) => level.value === props.value) ?? LEVELS[0];
  const Icon = () => {
    const Glyph = current().icon;
    return <Glyph />;
  };
  return (
    <label
      class="doc-share-level"
      data-borderless={props.borderless ? 'true' : undefined}
    >
      <Icon />
      {current().label}
      <CaretDown />
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value as Level)}
      >
        <For each={LEVELS}>
          {(level) => <option value={level.value}>{level.label}</option>}
        </For>
      </select>
    </label>
  );
}

const LINK_SCOPES = {
  NONE: {
    label: 'None',
    title: 'Link sharing off',
    description:
      'Only people and channels you explicitly share with can access this item.',
  },
  TEAM: {
    label: 'Team',
    title: 'Team link',
    description:
      "Members of the owner's team with the link can access this item. This does not share it directly with a team or channel.",
  },
  PUBLIC: {
    label: 'Public',
    title: 'Public link',
    description: 'Anyone with the link can access this item.',
  },
} as const;
type Scope = keyof typeof LINK_SCOPES;

const MATCHES: [RegExp, HomepagePersonId][] = [
  [/teo/i, 'teo'],
  [/julia/i, 'julia'],
  [/gabriel/i, 'gabriel'],
  [/valentina/i, 'valentina'],
];

/**
 * The document Share modal's three cards: the share form, "People with
 * access to this document" (owner, then channels and people), and link
 * sharing. Recipients stay local to the page and survive closing it.
 */
export function DocumentShareSheet(props: {
  open: boolean;
  title: string;
  /** The channel the doc was mentioned in, labeled by its other members. */
  channel?: { members: string; level: Level; fresh?: boolean; name?: string };
  channelDestination?: string;
  initialPermission?: Level;
  onShareChannel?: (message: string, level: Level) => void;
  onOpenChannel?: () => void;
  onReady?: (handle: DocumentShareHandle | undefined) => void;
  entityLabel?: string;
  autoFocus?: boolean;
  onClose: () => void;
}) {
  const titleId = createUniqueId();
  const [recipient, setRecipient] = createSignal('');
  const [level, setLevel] = createSignal<Level>(
    props.initialPermission ?? 'edit'
  );
  const [channelLevel, setChannelLevel] = createSignal<Level>();
  const [message, setMessage] = createSignal('');
  const [selectedChannel, setSelectedChannel] = createSignal(false);
  let messageInput: HTMLTextAreaElement | undefined;
  const showChannelOption = () =>
    !!props.channelDestination &&
    !selectedChannel() &&
    !!recipient().trim() &&
    props.channelDestination
      .toLowerCase()
      .includes(recipient().replace(/^#/, '').trim().toLowerCase());
  const chooseChannel = (focusMessage = false) => {
    if (!props.channelDestination) return;
    setSelectedChannel(true);
    setRecipient('#' + props.channelDestination);
    if (focusMessage)
      queueMicrotask(() => messageInput?.focus({ preventScroll: true }));
  };
  const [shared, setShared] = createSignal<
    { id: string; name: string; person?: HomepagePersonId; level: Level }[]
  >([]);
  const [scope, setScope] = createSignal<Scope>('NONE');
  const share = () => {
    const name = recipient().trim();
    if (!name) return;
    if (selectedChannel() && props.channelDestination) {
      props.onShareChannel?.(message(), level());
      setChannelLevel(undefined);
      setSelectedChannel(false);
      setRecipient('');
      setMessage('');
      return;
    }
    const person = MATCHES.find(([pattern]) => pattern.test(name))?.[1];
    setShared((rows) => [
      ...rows.filter((row) => row.person !== person || !person),
      {
        id: createUniqueId(),
        name: person ? homepagePeople[person].name : name,
        person,
        level: level(),
      },
    ]);
    setRecipient('');
  };
  onMount(() => {
    props.onReady?.({
      typeRecipient: (text) => {
        setSelectedChannel(false);
        setRecipient(text);
      },
      typeMessage: setMessage,
      selectChannel: chooseChannel,
      share,
      reset: () => {
        setRecipient('');
        setMessage('');
        setSelectedChannel(false);
        setLevel(props.initialPermission ?? 'edit');
        setChannelLevel(undefined);
        setShared([]);
        setScope('NONE');
      },
    });
    onCleanup(() => props.onReady?.(undefined));
  });
  return (
    <Show when={props.open}>
      <div
        class="doc-share-scrim"
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
          }
        }}
      >
        <section
          class="doc-share-card"
          role="dialog"
          ref={(element) => {
            if (props.autoFocus)
              queueMicrotask(() => element.querySelector('input')?.focus());
          }}
          aria-modal="false"
          aria-labelledby={titleId}
        >
          <header id={titleId}>
            <span>Share:</span>
            <Show
              when={props.entityLabel === 'conversation'}
              fallback={<FileText class="text-note" />}
            >
              <ChatTeardrop />
            </Show>
            <span>{props.title}</span>
          </header>
          <div class="doc-share-to">
            <Show
              when={selectedChannel()}
              fallback={
                <input
                  aria-label="Email or group"
                  placeholder="To: Email or group"
                  value={recipient()}
                  onInput={(event) => setRecipient(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    )
                      share();
                    else if (event.key === 'Enter' && showChannelOption()) {
                      event.preventDefault();
                      chooseChannel(true);
                    } else if (
                      event.key === 'ArrowDown' &&
                      showChannelOption()
                    ) {
                      event.preventDefault();
                      event.currentTarget.parentElement
                        ?.querySelector<HTMLElement>('[role="option"]')
                        ?.focus();
                    }
                  }}
                />
              }
            >
              <span class="doc-share-recipient-chip">
                <Hash class="size-4" />
                {props.channelDestination}
                <button
                  type="button"
                  aria-label="Remove channel recipient"
                  onClick={() => {
                    setSelectedChannel(false);
                    setRecipient('');
                  }}
                >
                  <X class="size-3" />
                </button>
              </span>
            </Show>
            <Show when={showChannelOption()}>
              <div
                class="doc-share-suggestions"
                role="listbox"
                aria-label="Channels"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected="true"
                  data-share-channel-option
                  onClick={() => chooseChannel(true)}
                >
                  <Hash class="size-4" />
                  <span>{props.channelDestination}</span>
                  <span class="ml-auto text-xs text-ink-muted">Channel</span>
                </button>
              </div>
            </Show>
            <Show
              when={
                selectedChannel() ||
                (!props.channelDestination && recipient().trim())
              }
            >
              <span class="doc-share-can">can</span>
            </Show>
            <AccessLevel
              label="Permission"
              value={level()}
              onChange={setLevel}
              borderless
            />
          </div>
          <textarea
            ref={messageInput}
            class="doc-share-message"
            aria-label="Optional message"
            placeholder="Optional message"
            value={message()}
            onInput={(event) => setMessage(event.currentTarget.value)}
          />
          <div class="doc-share-actions">
            <Button
              variant="ghost"
              size="sm"
              class="text-ink-extra-muted"
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="strong"
              depth={3}
              disabled={!recipient().trim() || showChannelOption()}
              data-share-submit
              onClick={share}
            >
              <PaperPlaneTilt class="size-4" />
              Share
              <kbd>⌘↵</kbd>
            </Button>
          </div>
        </section>
        <section class="doc-share-card" aria-label="People with access">
          <header>
            <span>
              People with access to this {props.entityLabel ?? 'document'}
            </span>
          </header>
          <div class="doc-share-people">
            <div class="doc-share-person">
              <span>
                <img src={homepagePeople.jacob.photo} alt="" />
                <span>Me</span>
              </span>
              <span class="doc-share-owner">Owner</span>
            </div>
            <Show when={props.channel}>
              {(channel) => (
                <div
                  class="doc-share-person"
                  data-new={channel().fresh ? 'true' : undefined}
                  data-channel-access
                >
                  <span>
                    <Show
                      when={props.onOpenChannel}
                      fallback={
                        <>
                          <Users />
                          <span>{channel().members}</span>
                        </>
                      }
                    >
                      <button
                        type="button"
                        data-open-shared-channel
                        class="doc-share-channel-link"
                        aria-label={`Open #${channel().name ?? 'launch'}`}
                        onClick={props.onOpenChannel}
                      >
                        <Hash class="size-4" />
                        <span>{channel().name ?? 'launch'}</span>
                        <span class="text-xs text-ink-muted">
                          {channel().members}
                        </span>
                      </button>
                    </Show>
                  </span>
                  <AccessLevel
                    label={`Access for ${channel().members}`}
                    value={channelLevel() ?? channel().level}
                    onChange={setChannelLevel}
                  />
                </div>
              )}
            </Show>
            <For each={shared()}>
              {(row) => (
                <div class="doc-share-person" data-new="true">
                  <span>
                    <Show when={row.person} fallback={<UserCircle />}>
                      {(person) => (
                        <img src={homepagePeople[person()].photo} alt="" />
                      )}
                    </Show>
                    <span>{row.name}</span>
                  </span>
                  <AccessLevel
                    label={`Access for ${row.name}`}
                    value={row.level}
                    onChange={(next) =>
                      setShared((rows) =>
                        rows.map((item) =>
                          item.id === row.id ? { ...item, level: next } : item
                        )
                      )
                    }
                  />
                </div>
              )}
            </For>
          </div>
        </section>
        <section class="doc-share-card" aria-label="Link sharing">
          <div class="doc-share-link">
            <div>
              <span>
                {LINK_SCOPES[scope()].title}
                <span class="doc-share-status">
                  {scope() === 'NONE'
                    ? props.channel || shared().length
                      ? 'Shared'
                      : 'Not shared'
                    : LINK_SCOPES[scope()].label}
                </span>
              </span>
              <span
                class="doc-share-scope"
                role="group"
                aria-label="Link sharing scope"
              >
                <For each={Object.keys(LINK_SCOPES) as Scope[]}>
                  {(option) => (
                    <button
                      type="button"
                      aria-pressed={scope() === option}
                      onClick={() => setScope(option)}
                    >
                      {LINK_SCOPES[option].label}
                    </button>
                  )}
                </For>
              </span>
            </div>
            <p>{LINK_SCOPES[scope()].description}</p>
          </div>
        </section>
      </div>
    </Show>
  );
}

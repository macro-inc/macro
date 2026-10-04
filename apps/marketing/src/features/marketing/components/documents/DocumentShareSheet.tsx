import CaretDown from '@phosphor/caret-down.svg';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import Eye from '@phosphor/eye.svg';
import FileText from '@phosphor/file-text.svg';
import PaperPlaneTilt from '@phosphor/paper-plane-tilt.svg';
import Pencil from '@phosphor/pencil.svg';
import UserCircle from '@phosphor/user-circle.svg';
import Users from '@phosphor/users.svg';
import { Button } from '@ui';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';

/** GroupChannelLabel for #launch: its other members, up to 20 characters. */
export const LAUNCH_MEMBERS = 'Julia, Teo, Gabriel +1 other';

type Level = 'view' | 'comment' | 'edit';
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
  channel: { members: string; level: Level; fresh?: boolean };
  onClose: () => void;
}) {
  const titleId = createUniqueId();
  const [recipient, setRecipient] = createSignal('');
  const [level, setLevel] = createSignal<Level>('edit');
  const [channelLevel, setChannelLevel] = createSignal(props.channel.level);
  const [shared, setShared] = createSignal<
    { id: string; name: string; person?: HomepagePersonId; level: Level }[]
  >([]);
  const [scope, setScope] = createSignal<Scope>('NONE');
  const share = () => {
    const name = recipient().trim();
    if (!name) return;
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
  return (
    <Show when={props.open}>
      <div
        class="doc-share-scrim"
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onClose();
        }}
      >
        <section
          class="doc-share-card"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
        >
          <header id={titleId}>
            <span>Share:</span>
            <FileText class="text-note" />
            <span>{props.title}</span>
          </header>
          <div class="doc-share-to">
            <input
              aria-label="Email or group"
              placeholder="To: Email or group"
              value={recipient()}
              onInput={(event) => setRecipient(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
                  share();
              }}
            />
            <Show when={recipient().trim()}>
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
            class="doc-share-message"
            aria-label="Optional message"
            placeholder="Optional message"
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
              disabled={!recipient().trim()}
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
            <span>People with access to this document</span>
          </header>
          <div class="doc-share-people">
            <div class="doc-share-person">
              <span>
                <img src={homepagePeople.jacob.photo} alt="" />
                <span>Me</span>
              </span>
              <span class="doc-share-owner">Owner</span>
            </div>
            <div
              class="doc-share-person"
              data-new={props.channel.fresh ? 'true' : undefined}
              data-channel-access
            >
              <span>
                <Users />
                <span>{props.channel.members}</span>
              </span>
              <AccessLevel
                label={`Access for ${props.channel.members}`}
                value={channelLevel()}
                onChange={setChannelLevel}
              />
            </div>
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
                  {scope() === 'NONE' ? 'Shared' : LINK_SCOPES[scope()].label}
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

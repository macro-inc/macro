import { UserIcon } from '@core/component/UserIcon';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications/types';
import CaretRightIcon from '@phosphor-icons/core/regular/caret-right.svg?component-solid';
import { Property } from '@property';
import type { Property as PropertyT } from '@property/types';
import { Avatar, Button, type ButtonProps, cn, Layer } from '@ui';
import { format } from 'date-fns';
import {
  type Accessor,
  createContext,
  For,
  type JSX,
  Show,
  splitProps,
  useContext,
} from 'solid-js';

type InboxItemNotification =
  | UnifiedNotification
  | {
      notification_metadata: {
        tag:
          | UnifiedNotification['notification_metadata']['tag']
          | 'call-started';
        content: Record<string, unknown>;
      };
    };

export interface InboxItem {
  id: string;
  notification?: InboxItemNotification;
  entityId?: string;
  entityType?: EntityData['type'];
  entityName?: string;
  senderId?: string;
  senderName?: string;
  action?: string;
  targetName?: string;
  content?: string;
  properties?: PropertyT[];
  breadcrumb?: string[];
  subItems?: InboxItem[];
  timestamp?: string;
  unread?: boolean;
}

type InboxItemContextValue = {
  item: Accessor<InboxItem>;
  unread: Accessor<boolean | undefined>;
  selected: Accessor<boolean | undefined>;
  highlighted: Accessor<boolean | undefined>;
};

const InboxItemContext = createContext<InboxItemContextValue>();

export const useInboxItem = () => {
  const ctx = useContext(InboxItemContext);
  if (!ctx) throw new Error('InboxItem must be used within InboxItem.Root');
  return ctx;
};

interface SlotProps {
  children?: JSX.Element;
  class?: string;
}

interface RootProps {
  item: InboxItem;
  children: JSX.Element;
  unread?: boolean;
  selected?: boolean;
  highlighted?: boolean;
  class?: string;
}

function Root(props: RootProps) {
  const item = () => props.item;
  const unread = () =>
    props.unread ??
    (item().unread || item().subItems?.some((subItem) => subItem.unread));
  const selected = () => props.selected;
  const highlighted = () => props.highlighted;
  const context: InboxItemContextValue = {
    item,
    unread,
    selected,
    highlighted,
  };

  return (
    <InboxItemContext.Provider value={context}>
      <div
        class={cn(
          'group/inbox-item grid w-full grid-cols-[0.5rem_var(--inbox-item-icon-size)_minmax(0,1fr)] gap-x-3 text-sm',
          '[--inbox-item-icon-size:2rem]',
          props.class
        )}
      >
        {props.children}
      </div>
    </InboxItemContext.Provider>
  );
}

interface ContentProps extends SlotProps {
  onClick?: (event: MouseEvent) => void;
}

function Content(props: ContentProps) {
  const ctx = useInboxItem();
  const interactive = () => Boolean(props.onClick);

  return (
    <div
      class={cn(
        'col-span-3 grid w-full grid-cols-[0.5rem_var(--inbox-item-icon-size)_minmax(0,1fr)] items-center gap-x-3 rounded-lg px-2',
        'min-h-11 bg-surface py-1.5',
        ctx.unread() === false && 'opacity-70',
        !ctx.selected() &&
          !ctx.highlighted() &&
          'hover:bg-active/40 hover:ring hover:ring-edge-muted hover:ring-inset',
        ctx.highlighted() && 'bg-active/50 ring ring-edge-muted ring-inset',
        interactive() &&
          'outline-none focus-visible:bg-accent/10 focus-visible:ring focus-visible:ring-accent/40 focus-visible:ring-inset',
        props.class
      )}
      role={interactive() ? 'button' : undefined}
      tabIndex={interactive() ? 0 : undefined}
      onClick={props.onClick}
      onKeyDown={(event) => {
        if (!interactive()) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onClick?.(event as unknown as MouseEvent);
      }}
    >
      {props.children}
    </div>
  );
}

function Leading(props: SlotProps) {
  return (
    <span
      class={cn('grid size-2.5 place-items-center self-center', props.class)}
      aria-hidden="true"
    >
      {props.children}
    </span>
  );
}

function UnreadIndicator(props: { unread?: boolean; class?: string }) {
  const ctx = useInboxItem();
  const grouped = () => Boolean(ctx.item().subItems?.length);

  return (
    <Show when={grouped()}>
      <CaretRightIcon
        class={cn('size-2.5 text-ink-extra-muted', props.class)}
      />
    </Show>
  );
}

function Icon(props: SlotProps) {
  return (
    <span
      class={cn(
        'flex shrink-0 self-center items-center justify-center overflow-visible text-ink-muted',
        'min-w-[var(--inbox-item-icon-size)] h-[var(--inbox-item-icon-size)]',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

function Body(props: SlotProps) {
  return (
    <div class={cn('flex min-w-0 flex-1 flex-col', 'gap-0.5', props.class)}>
      {props.children}
    </div>
  );
}

interface HeaderProps extends SlotProps {}

function Header(props: HeaderProps) {
  return (
    <div class={cn('flex min-w-0 items-center', 'gap-1.5', props.class)}>
      {props.children}
    </div>
  );
}

function useSenderDisplayName() {
  const ctx = useInboxItem();
  const fallbackName = () =>
    ctx.item().senderName || ctx.item().senderId || '?';
  const macroId = tryMacroId(ctx.item().senderId ?? fallbackName());
  const [displayName] = useDisplayName(macroId);
  const name = () => {
    if (displayName()) return displayName();
    if (macroId) return macroIdToEmail(macroId);
    return fallbackName();
  };

  return { macroId, name };
}

interface SenderProps extends SlotProps {
  avatar?: boolean;
}

function Sender(props: SenderProps) {
  const { macroId, name } = useSenderDisplayName();
  const showAvatar = () => props.avatar ?? true;
  const initials = () =>
    name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part: string) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <span
      class={cn(
        'min-w-0 shrink-0 inline-flex items-center gap-1',
        'text-xs',
        'text-ink',
        props.class
      )}
    >
      <Show when={showAvatar()}>
        <span class="size-3 shrink-0 overflow-hidden rounded-full">
          <Show
            when={macroId}
            fallback={
              <Avatar size="fill" class="text-[8px]">
                <Avatar.Fallback>{initials()}</Avatar.Fallback>
              </Avatar>
            }
          >
            {(senderId) => (
              <UserIcon
                id={senderId()}
                size="fill"
                suppressClick
                showTooltip={false}
              />
            )}
          </Show>
        </span>
      </Show>
      <span class="min-w-0 truncate">{name()}</span>
    </span>
  );
}

function formatTimestamp(value: JSX.Element) {
  if (typeof value !== 'string') return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return format(date, 'p');
}

function Timestamp(props: SlotProps) {
  return (
    <span class={cn('shrink-0 text-xs text-ink-extra-muted/70', props.class)}>
      {formatTimestamp(props.children)}
    </span>
  );
}

interface LinkProps extends SlotProps {
  href?: string;
  title?: string;
}

function Link(props: LinkProps) {
  const className = () =>
    cn(
      'min-w-0 truncate text-xs text-ink-muted/70 underline-offset-2 transition-colors hover:text-accent hover:underline',
      props.class
    );

  return (
    <Show
      when={props.href}
      fallback={
        <span class={className()} title={props.title}>
          {props.children}
        </span>
      }
    >
      {(href) => (
        <a
          class={className()}
          href={href()}
          title={props.title}
          onClick={(event) => event.stopPropagation()}
        >
          {props.children}
        </a>
      )}
    </Show>
  );
}

interface DescriptionProps extends SlotProps {
  timestamp?: boolean;
}

function Description(props: DescriptionProps) {
  const [local, rest] = splitProps(props, ['timestamp', 'class', 'children']);
  const parent = useInboxItem();
  const showTimestamp = () => local.timestamp ?? true;
  const groupCount = () => {
    const count = (parent.item().subItems?.length ?? 0) + 1;
    return count > 1 ? count : undefined;
  };
  const unreadSubItemCount = () =>
    parent.item().subItems?.filter((subItem) => subItem.unread).length ?? 0;
  const showUnreadDot = () => {
    if (groupCount()) return parent.item().unread || unreadSubItemCount() === 1;
    return parent.unread() || parent.item().unread;
  };
  const badgeCount = () => {
    if (unreadSubItemCount() > 1) return unreadSubItemCount();
    return groupCount();
  };
  const context: InboxItemContextValue = {
    ...parent,
  };

  return (
    <InboxItemContext.Provider value={context}>
      <div
        class={cn(
          'flex min-w-0 items-center gap-1 truncate text-ink-muted/70 text-xs',
          local.class
        )}
        {...rest}
      >
        {local.children}
        <Show when={showTimestamp()}>
          <Show
            when={showUnreadDot()}
            fallback={
              <Show
                when={badgeCount()}
                fallback={
                  <Show when={parent.item().timestamp}>
                    {(timestamp) => (
                      <Timestamp class="ml-auto">{timestamp()}</Timestamp>
                    )}
                  </Show>
                }
              >
                {(count) => (
                  <Layer depth={5}>
                    <span
                      class={cn(
                        'ml-auto grid h-4 min-w-4 place-items-center rounded px-1 text-xs',
                        unreadSubItemCount() > 1
                          ? 'bg-accent text-surface'
                          : 'bg-ink-muted/10 text-ink-muted'
                      )}
                    >
                      {count()}
                    </span>
                  </Layer>
                )}
              </Show>
            }
          >
            <span class="ml-auto size-2 rounded-full bg-accent" />
          </Show>
        </Show>
      </div>
    </InboxItemContext.Provider>
  );
}

interface ContextSlotProps extends SlotProps {}

function Section(props: ContextSlotProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div class={cn('flex min-w-0 flex-col gap-1', local.class)} {...rest}>
      {local.children}
    </div>
  );
}

function ActionsRow(props: SlotProps) {
  return (
    <div class={cn('col-start-3 flex min-w-0 items-center gap-2', props.class)}>
      {props.children}
    </div>
  );
}

interface ActionButtonProps extends ButtonProps {}

function ActionButton(props: ActionButtonProps) {
  const [local, rest] = splitProps(props, ['class', 'children', 'type']);

  return (
    <Button
      class={cn('text-accent not-disabled:hover:text-accent', local.class)}
      size="sm"
      type={local.type ?? 'button'}
      variant="ghost"
      {...rest}
    >
      {local.children}
    </Button>
  );
}

interface PillProps extends SlotProps {
  title?: string;
  variant?: 'default' | 'muted' | 'accent';
}

export function Pill(props: PillProps) {
  const variant = () => props.variant ?? 'default';

  return (
    <span
      class={cn(
        'inline-flex h-5 max-w-full min-w-0 items-center rounded-full border px-1.5 text-xs text-ink-muted',
        variant() === 'default' && 'border-edge-muted',
        variant() === 'muted' && 'border-edge-muted/70 text-ink-extra-muted',
        variant() === 'accent' && 'border-accent/20 bg-accent/8 text-accent',
        props.class
      )}
      title={props.title}
    >
      {props.children}
    </span>
  );
}

interface PropertyPillProps {
  property: PropertyT;
  class?: string;
}

export function PropertyPill(props: PropertyPillProps) {
  return (
    <span
      class={cn('grid size-4 shrink-0 place-items-center', props.class)}
      title={props.property.displayName}
    >
      <Property.Icon property={props.property} class="size-3 shrink-0" />
    </span>
  );
}

export function SharedPill(props: { label?: JSX.Element; class?: string }) {
  return <Pill class={props.class}>{props.label ?? 'Shared'}</Pill>;
}

interface BreadcrumbProps {
  items: readonly JSX.Element[];
  class?: string;
}

export function Breadcrumb(props: BreadcrumbProps) {
  return (
    <span
      class={cn(
        'flex min-w-0 items-center overflow-hidden text-ink-muted/70',
        props.class
      )}
    >
      <For each={props.items}>
        {(item, index) => (
          <>
            <Show when={index() > 0}>
              <span class="shrink-0 px-1 text-ink-extra-muted">/</span>
            </Show>
            <span class="min-w-0 truncate">{item}</span>
          </>
        )}
      </For>
    </span>
  );
}

export const InboxItem = {
  Root,
  Section,
  Leading,
  UnreadIndicator,
  Icon,
  Body,
  Header,
  Sender,
  Timestamp,
  Content,
  Link,
  Description,
  Pill,
  ActionsRow,
  ActionButton,
};

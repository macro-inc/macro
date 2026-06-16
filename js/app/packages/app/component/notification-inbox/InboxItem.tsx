import { UserIcon } from '@core/component/UserIcon';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications/types';
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
export type InboxItemDensity = 'default' | 'compact';
export type InboxItemTone = 'default' | 'muted';

export interface InboxItemStyleProps {
  density?: InboxItemDensity;
  tone?: InboxItemTone;
}

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
  density: Accessor<InboxItemDensity>;
  tone: Accessor<InboxItemTone>;
  unread: Accessor<boolean | undefined>;
  selected: Accessor<boolean | undefined>;
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
  density?: InboxItemDensity;
  tone?: InboxItemTone;
  class?: string;
}

function Root(props: RootProps) {
  const item = () => props.item;
  const density = () => props.density ?? 'default';
  const tone = () => props.tone ?? 'default';
  const unread = () => props.unread ?? item().unread;
  const selected = () => props.selected;
  const context: InboxItemContextValue = {
    item,
    density,
    tone,
    unread,
    selected,
  };

  return (
    <InboxItemContext.Provider value={context}>
      <div
        class={cn(
          'group/inbox-item grid w-full grid-cols-[0.5rem_var(--inbox-item-icon-size)_minmax(0,1fr)] gap-x-3 text-sm',
          density() === 'compact'
            ? '[--inbox-item-icon-size:2rem]'
            : '[--inbox-item-icon-size:2rem]',
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
        ctx.density() === 'compact' ? 'min-h-9 py-1' : 'min-h-11 py-1.5',
        ctx.tone() === 'muted' ? 'bg-ink-muted/2.5' : 'bg-surface',
        'hover:ring hover:ring-edge hover:ring-inset',
        ctx.selected() && 'bg-active/60 hover:ring-0',
        interactive() &&
          'outline-none focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset',
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
      <Indicator />
      {props.children}
    </div>
  );
}

function Indicator(props: { unread?: boolean; class?: string }) {
  const ctx = useInboxItem();
  const unread = () => props.unread ?? ctx.unread();

  return (
    <span
      class={cn('grid size-2 place-items-center', props.class)}
      aria-hidden="true"
    >
      <Show when={unread()}>
        <span class="size-1.5 rounded-full bg-accent" />
      </Show>
    </span>
  );
}

function Icon(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <span
      class={cn(
        'flex shrink-0 self-start items-center justify-center overflow-visible text-ink-muted',
        ctx.density() === 'compact'
          ? 'min-w-4 h-4'
          : 'min-w-[var(--inbox-item-icon-size)] h-[var(--inbox-item-icon-size)]',
        ctx.tone() === 'muted' && 'text-ink-extra-muted',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

function Body(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <div
      class={cn(
        'flex min-w-0 flex-1 flex-col',
        ctx.density() === 'compact' ? 'gap-0' : 'gap-0.5',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

interface HeaderProps extends SlotProps {}

function Header(props: HeaderProps) {
  const ctx = useInboxItem();

  return (
    <div
      class={cn(
        'flex min-w-0 items-center',
        ctx.density() === 'compact' ? 'gap-1' : 'gap-1.5',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function Sender(props: SlotProps) {
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
  const initials = () =>
    name()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?';

  return (
    <span
      class={cn(
        'min-w-0 shrink-0 inline-flex items-center gap-1',
        'text-xs',
        ctx.tone() === 'muted' ? 'text-ink-muted' : 'text-ink',
        props.class
      )}
    >
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
  const ctx = useInboxItem();
  const className = () =>
    cn(
      'min-w-0 truncate text-xs text-ink-muted/70 underline-offset-2 transition-colors hover:text-accent hover:underline',
      ctx.tone() === 'muted' && 'text-ink-extra-muted',
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

interface DescriptionProps extends SlotProps, InboxItemStyleProps {
  timestamp?: boolean;
}

function Description(props: DescriptionProps) {
  const [local, rest] = splitProps(props, [
    'density',
    'tone',
    'timestamp',
    'class',
    'children',
  ]);
  const parent = useInboxItem();
  const density = () => local.density ?? parent.density();
  const tone = () => local.tone ?? parent.tone();
  const showTimestamp = () => local.timestamp ?? true;
  const context: InboxItemContextValue = {
    ...parent,
    density,
    tone,
  };

  return (
    <InboxItemContext.Provider value={context}>
      <div
        class={cn(
          'flex min-w-0 items-center text-ink-muted/70 gap-1 text-xs',
          local.class
        )}
        {...rest}
      >
        {local.children}
        <Show when={showTimestamp()}>
          <Show
            when={parent.item().subItems?.length}
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
                <span class="ml-auto grid h-4 min-w-4 place-items-center rounded-md bg-active px-1 text-xs text-ink-muted">
                  {count()}
                </span>
              </Layer>
            )}
          </Show>
        </Show>
      </div>
    </InboxItemContext.Provider>
  );
}

interface ContextSlotProps extends SlotProps, InboxItemStyleProps {}

function Section(props: ContextSlotProps) {
  const [local, rest] = splitProps(props, [
    'density',
    'tone',
    'class',
    'children',
  ]);
  const parent = useInboxItem();
  const density = () => local.density ?? parent.density();
  const tone = () => local.tone ?? parent.tone();
  const context: InboxItemContextValue = {
    ...parent,
    density,
    tone,
  };

  return (
    <InboxItemContext.Provider value={context}>
      <div class={cn('flex min-w-0 flex-col gap-1', local.class)} {...rest}>
        {local.children}
      </div>
    </InboxItemContext.Provider>
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

interface PillProps extends SlotProps, InboxItemStyleProps {
  title?: string;
  variant?: 'default' | 'muted' | 'accent';
}

export function Pill(props: PillProps) {
  const variant = () => props.variant ?? 'default';
  const density = () => props.density ?? 'default';
  const tone = () => props.tone ?? 'default';

  return (
    <span
      class={cn(
        'inline-flex max-w-full min-w-0 items-center rounded-full border text-ink-muted',
        density() === 'compact' ? 'h-4 px-1 text-[10px]' : 'h-5 px-1.5 text-xs',
        variant() === 'default' && 'border-edge-muted',
        variant() === 'muted' && 'border-edge-muted/70 text-ink-extra-muted',
        variant() === 'accent' && 'border-accent/20 bg-accent/8 text-accent',
        tone() === 'muted' &&
          variant() === 'default' &&
          'border-edge-muted/70 text-ink-extra-muted',
        props.class
      )}
      title={props.title}
    >
      {props.children}
    </span>
  );
}

interface PropertyPillProps extends InboxItemStyleProps {
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

export function SharedPill(
  props: InboxItemStyleProps & {
    label?: JSX.Element;
    class?: string;
  }
) {
  return (
    <Pill class={props.class} density={props.density} tone={props.tone}>
      {props.label ?? 'Shared'}
    </Pill>
  );
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
  Indicator,
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

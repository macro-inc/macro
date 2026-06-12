import type { NotificationType } from '@core/types';
import type { EntityData } from '@entity';
import { cn } from '@ui';
import {
  type Accessor,
  createContext,
  For,
  type JSX,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import type {
  InboxItemDensity,
  InboxItemStyleProps,
  InboxItemTone,
} from './types';

export interface InboxItem {
  id: string;
  notificationId?: string;
  notificationType?: NotificationType;
  entityId?: string;
  entityType?: EntityData['type'];
  entityName?: string;
  senderId?: string;
  senderName?: string;
  action?: string;
  targetName?: string;
  content?: string;
  context?: string;
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

interface RootProps {
  item: InboxItem;
  children: JSX.Element;
  unread?: boolean;
  selected?: boolean;
  density?: InboxItemDensity;
  tone?: InboxItemTone;
  class?: string;
  onClick?: (event: MouseEvent) => void;
}

interface SlotProps {
  children?: JSX.Element;
  class?: string;
}

export interface PillProps extends SlotProps, InboxItemStyleProps {
  title?: string;
  variant?: 'default' | 'muted' | 'accent';
}

export interface PropertyPillProps extends InboxItemStyleProps {
  name: JSX.Element;
  value?: JSX.Element;
  class?: string;
}

export interface BreadcrumbProps {
  items: readonly JSX.Element[];
  class?: string;
}

interface ContextSlotProps extends SlotProps, InboxItemStyleProps {}

interface HeaderProps extends SlotProps {
  timestamp?: JSX.Element;
}

interface SummaryProps {
  senderName?: JSX.Element;
  action?: JSX.Element;
  targetName?: JSX.Element;
  timestamp?: JSX.Element;
}

function Root(props: RootProps) {
  const item = () => props.item;
  const density = () => props.density ?? 'default';
  const tone = () => props.tone ?? 'default';
  const unread = () => props.unread ?? item().unread;
  const selected = () => props.selected;
  const interactive = () => Boolean(props.onClick);
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
          'group/inbox-item grid w-full items-center gap-2 rounded-lg text-sm',
          'grid-cols-[0.75rem_var(--inbox-item-icon-size)_minmax(0,1fr)_auto]',
          density() === 'compact'
            ? 'min-h-9 px-2 py-1 [--inbox-item-icon-size:1rem]'
            : 'min-h-11 px-2 py-1.5 [--inbox-item-icon-size:1.25rem]',
          tone() === 'muted' ? 'bg-ink-muted/2.5' : 'bg-surface',
          'hover:bg-ink-muted/6',
          selected() && 'bg-active/60 ring ring-edge ring-inset',
          interactive() && 'outline-none focus-visible:bg-active',
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
    </InboxItemContext.Provider>
  );
}

function Indicator(props: { unread?: boolean; class?: string }) {
  const ctx = useInboxItem();
  const unread = () => props.unread ?? ctx.unread();

  return (
    <span
      class={cn('grid size-3 place-items-center', props.class)}
      aria-hidden="true"
    >
      <span
        class={cn(
          'rounded-full',
          ctx.density() === 'compact' ? 'size-1' : 'size-1.5',
          {
            'bg-accent': unread(),
            'bg-transparent': !unread(),
          }
        )}
      />
    </span>
  );
}

function Icon(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <span
      class={cn(
        'grid place-items-center overflow-visible text-ink-muted',
        ctx.density() === 'compact' ? 'size-4' : 'size-5',
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
        'min-w-0 flex flex-col',
        ctx.density() === 'compact' ? 'gap-0' : 'gap-0.5',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

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
      {props.timestamp !== undefined && (
        <Timestamp>{props.timestamp}</Timestamp>
      )}
    </div>
  );
}

function Summary(props: SummaryProps = {}) {
  const { item } = useInboxItem();
  const senderName = () => props.senderName ?? item().senderName;
  const action = () => props.action ?? item().action;
  const targetName = () =>
    props.targetName ?? item().targetName ?? item().entityName;
  const timestamp = () => props.timestamp ?? item().timestamp;

  return (
    <Header timestamp={timestamp()}>
      {senderName() !== undefined && <Sender>{senderName()}</Sender>}
      {action() !== undefined && <Action>{action()}</Action>}
      {targetName() !== undefined && <TargetName>{targetName()}</TargetName>}
    </Header>
  );
}

function Sender(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <span
      class={cn(
        'min-w-0 truncate font-medium shrink-0',
        ctx.density() === 'compact' ? 'text-[11px]' : 'text-xs',
        ctx.tone() === 'muted' ? 'text-ink-muted' : 'text-ink',
        ctx.unread() && 'font-semibold',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

function Action(props: SlotProps) {
  return (
    <span class={cn('shrink-0 text-xs text-ink-muted', props.class)}>
      {props.children}
    </span>
  );
}

function TargetName(props: SlotProps) {
  return <Content class={props.class}>{props.children}</Content>;
}

function Timestamp(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <span
      class={cn(
        'shrink-0 text-ink-extra-muted',
        ctx.density() === 'compact' ? 'text-[11px]' : 'text-xs',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

function Content(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <span
      class={cn(
        'min-w-0 truncate text-ink-muted/70',
        ctx.density() === 'compact' ? 'text-[11px]' : 'text-xs',
        ctx.tone() === 'muted' && 'text-ink-extra-muted',
        props.class
      )}
    >
      {props.children}
    </span>
  );
}

function Context(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <div
      class={cn(
        'flex min-w-0 items-center text-ink-muted/70',
        ctx.density() === 'compact' ? 'gap-1 text-[11px]' : 'gap-1.5 text-xs',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

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

function CompactContext(props: SlotProps) {
  return (
    <Section density="compact">
      <Context class={props.class}>{props.children}</Context>
    </Section>
  );
}

export function Pill(props: PillProps) {
  const variant = () => props.variant ?? 'default';
  const density = () => props.density ?? 'default';
  const tone = () => props.tone ?? 'default';

  return (
    <span
      class={cn(
        'inline-flex max-w-full min-w-0 items-center rounded-full border text-ink-muted',
        density() === 'compact'
          ? 'h-4 px-1 text-[10px]'
          : 'h-5 px-1.5 text-[11px]',
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

function Trailing(props: SlotProps) {
  const ctx = useInboxItem();

  return (
    <div
      class={cn(
        'flex shrink-0 items-center justify-end',
        ctx.density() === 'compact' ? 'ml-1' : 'ml-2',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

export function PropertyPill(props: PropertyPillProps) {
  return (
    <Pill
      class={cn('gap-1', props.class)}
      density={props.density}
      tone={props.tone}
    >
      <span class="min-w-0 truncate">{props.name}</span>
      <Show when={props.value}>
        {(value) => (
          <>
            <span class="shrink-0 text-ink-extra-muted">:</span>
            <span class="min-w-0 truncate text-ink-muted">{value()}</span>
          </>
        )}
      </Show>
    </Pill>
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
  Summary,
  Sender,
  Action,
  TargetName,
  Timestamp,
  Content,
  Context,
  CompactContext,
  Pill,
  Trailing,
};

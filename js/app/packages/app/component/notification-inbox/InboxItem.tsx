import { mapMediaItems } from '@channel/Media/media-items';
import { ItemPreview } from '@core/component/ItemPreview';
import { UserIcon } from '@core/component/UserIcon';
import { MACRO_AGENT_BOT_ID } from '@core/constant/macroAgent';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import type { EntityData } from '@entity';
import { stringToItemType } from '@service-storage/client';
import type { SoupMessageAttachment } from '@service-storage/generated/schemas';
import MacroLogo from '@icon/macro-logo.svg';
import type { UnifiedNotification } from '@notifications/types';
import { Property } from '@property';
import type { Property as PropertyT } from '@property/types';
import { Avatar as UIAvatar, cn } from '@ui';
import {
  type Accessor,
  createContext,
  createMemo,
  For,
  type JSX,
  Show,
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

export type InboxRelatedDocument = {
  id: string;
  name: string;
  fileType?: string;
  senderName?: string;
  subType?: string;
};

export interface InboxItem {
  id: string;
  notification?: InboxItemNotification;
  previewEntity?: EntityData;
  entityId?: string;
  entityType?: EntityData['type'];
  entitySubType?: string;
  entityName?: string;
  channelType?: string;
  senderId?: string;
  senderName?: string;
  action?: string;
  targetName?: string;
  content?: string;
  properties?: PropertyT[];
  relatedDocuments?: InboxRelatedDocument[];
  attachments?: SoupMessageAttachment[];
  callStatuses?: string[];
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
  expanded: Accessor<boolean | undefined>;
};

const InboxItemContext = createContext<InboxItemContextValue>();

export const useInboxItem = () => {
  const ctx = useContext(InboxItemContext);
  if (!ctx) throw new Error('InboxItem must be used within InboxItem.Root');
  return ctx;
};

export function parseInboxSenderName(item: InboxItem) {
  const name = item.senderName || item.senderId || '?';
  const emailMatch = name.match(/^"?([^"<]+)"?\s*</);
  if (emailMatch?.[1]) return emailMatch[1].trim();
  const parsedMacroId = tryMacroId(name);
  if (parsedMacroId) return macroIdToEmail(parsedMacroId);
  return name;
}

export function useInboxItemSenderName(source?: Accessor<InboxItem>) {
  const ctx = source ? undefined : useInboxItem();
  const item = source ?? ctx!.item;
  const macroId = () => {
    const sender = item().senderId ?? item().senderName;
    return sender ? tryMacroId(sender) : undefined;
  };
  const fallback = () => parseInboxSenderName(item());
  const [displayName] = useDisplayName(macroId());
  return () =>
    displayName() || (macroId() ? macroIdToEmail(macroId()!) : fallback());
}

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
  expanded?: boolean;
  class?: string;
}

function Root(props: RootProps) {
  const item = () => props.item;
  const unread = () => {
    const hasUnreadSubItems = item().subItems?.some(
      (subItem) => subItem.unread
    );
    return props.unread ?? Boolean(item().unread || hasUnreadSubItems);
  };
  const selected = () => props.selected;
  const highlighted = () => props.highlighted;
  const expanded = () => props.expanded;
  const context: InboxItemContextValue = {
    item,
    unread,
    selected,
    highlighted,
    expanded,
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

function Body(props: SlotProps) {
  return (
    <div class={cn('flex min-w-0 flex-1 flex-col', 'gap-0.5', props.class)}>
      {props.children}
    </div>
  );
}

interface SenderProps extends SlotProps {
  item?: InboxItem;
  avatar?: boolean;
  showName?: boolean;
  avatarClass?: string;
  fallbackClass?: string;
  macroAgent?: boolean;
  style?: JSX.CSSProperties;
}

function Sender(props: SenderProps) {
  const ctx = props.item ? undefined : useInboxItem();
  const item = () => props.item ?? ctx!.item();
  const name = useInboxItemSenderName(item);
  const showAvatar = () => props.avatar ?? true;
  const showName = () => props.showName ?? true;
  const macroId = () => {
    if (
      props.macroAgent ||
      item().notification?.notification_metadata.tag === 'ai_response'
    ) {
      return MACRO_AGENT_BOT_ID;
    }
    const sender = item().senderId;
    return sender ? tryMacroId(sender) : undefined;
  };
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
        'min-w-0 shrink-0 inline-flex items-center',
        showName() && 'gap-1 text-xs text-ink',
        props.class
      )}
      style={props.style}
    >
      <Show when={showAvatar()}>
        <span
          class={cn(
            'inline-flex size-3 shrink-0 overflow-hidden rounded-full',
            props.avatarClass
          )}
        >
          <Show
            when={macroId()}
            fallback={
              <Show
                when={item().senderId === 'macro-agent'}
                fallback={
                  <UIAvatar
                    size="fill"
                    class={props.fallbackClass ?? 'text-[8px]'}
                  >
                    <UIAvatar.Fallback>{initials()}</UIAvatar.Fallback>
                  </UIAvatar>
                }
              >
                <MacroLogo class="m-auto size-1/2" />
              </Show>
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
      <Show when={showName()}>
        <span class="min-w-0 truncate">{name()}</span>
      </Show>
    </span>
  );
}

function AttachmentPreviewTile(props: { attachment: SoupMessageAttachment }) {
  const mediaItem = () => mapMediaItems([props.attachment])[0];

  return (
    <Show
      when={mediaItem()}
      fallback={
        <ItemPreview
          id={props.attachment.entity_id}
          type={stringToItemType(props.attachment.entity_type)}
        />
      }
    >
      {(item) => (
        <Show
          when={item().kind === 'image'}
          fallback={
            <video
              class="size-12 rounded-lg border border-edge object-cover"
              muted
              playsinline
              preload="metadata"
              src={item().src}
            />
          }
        >
          <img
            alt="Attachment preview"
            class="size-12 rounded-lg border border-edge object-cover"
            loading="lazy"
            src={item().thumbSrc ?? item().src}
          />
        </Show>
      )}
    </Show>
  );
}

function AttachmentPreviews(props: {
  attachments?: SoupMessageAttachment[];
  class?: string;
}) {
  const visibleAttachments = createMemo(() =>
    (props.attachments ?? []).slice(0, 4)
  );
  const overflowCount = createMemo(() =>
    Math.max((props.attachments?.length ?? 0) - visibleAttachments().length, 0)
  );

  return (
    <Show when={props.attachments?.length}>
      <div
        class={cn(
          'flex max-w-full flex-wrap items-center gap-1.5',
          props.class
        )}
      >
        <For each={visibleAttachments()}>
          {(attachment) => <AttachmentPreviewTile attachment={attachment} />}
        </For>
        <Show when={overflowCount() > 0}>
          <div class="grid size-12 place-items-center rounded-lg border border-edge bg-surface text-xs font-medium text-ink-muted">
            +{overflowCount()}
          </div>
        </Show>
      </div>
    </Show>
  );
}

function Timestamp(props: SlotProps) {
  return (
    <span class={cn('shrink-0 text-xs text-ink-extra-muted/70', props.class)}>
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

export const InboxItem = {
  Root,
  Body,
  Sender,
  AttachmentPreviews,
  Timestamp,
  Content,
};

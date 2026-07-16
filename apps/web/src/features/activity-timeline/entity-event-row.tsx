import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from '@core/component/UserIcon';
import type { ChannelEntity, EntityData } from '@entity';
import { cn } from '@ui';
import { formatDistanceToNowStrict } from 'date-fns';
import { createMemo, Show } from 'solid-js';
import type { TimelineItem } from './timeline-types';

type EntityEvent = Extract<TimelineItem, { kind: 'entity-event' }>;

/**
 * The "actor verb location" title plus optional content snippet for an
 * entity-derived event, e.g. "You sent a message in #general" with the
 * message text below.
 */
function eventText(
  item: EntityEvent,
  resolveChannel: (channelId: string) => ChannelEntity | undefined
): { title: string; preview?: string } {
  const entity = item.entity;

  const channelLocation = (): string | undefined => {
    if (entity.type !== 'channel_thread') return undefined;
    const channel = resolveChannel(entity.channelId);
    if (!channel) return undefined;
    if (channel.channelType === 'direct_message') {
      return channel.name.trim() ? `a DM with ${channel.name}` : 'a DM';
    }
    return channel.name.trim() ? `#${channel.name}` : undefined;
  };

  const emailSubject = entity.type === 'email' ? entity.name : undefined;
  const emailSnippet = entity.type === 'email' ? entity.snippet : undefined;
  const emailPreview = emailSubject
    ? `**${emailSubject}**${emailSnippet ? ` — ${emailSnippet}` : ''}`
    : emailSnippet;

  switch (item.verb) {
    case 'sent-message': {
      const location = channelLocation();
      return {
        title: location
          ? `You sent a message in ${location}`
          : 'You sent a message',
        preview: entity.type === 'channel_thread' ? entity.content : undefined,
      };
    }
    case 'replied-in-thread': {
      const location = channelLocation();
      return {
        title: location
          ? `You replied in a thread in ${location}`
          : 'You replied in a thread',
        preview: entity.type === 'channel_thread' ? entity.content : undefined,
      };
    }
    case 'sent-email':
      return { title: 'You sent an email', preview: emailPreview };
    case 'drafted-email':
      return { title: 'You drafted an email', preview: emailPreview };
    case 'email-activity': {
      const sender =
        entity.type === 'email'
          ? (entity.senderName ?? entity.senderEmail)
          : undefined;
      return {
        title: sender ? `${sender} emailed` : 'Email activity',
        preview: emailPreview,
      };
    }
    case 'created-document':
      return { title: `You created “${entity.name}”` };
    case 'edited-document':
      return { title: `You edited “${entity.name}”` };
    case 'created-task':
      return { title: 'You created a task', preview: entity.name };
    case 'created-folder':
      return { title: `You created the folder “${entity.name}”` };
    case 'agent-chat':
      return { title: 'You worked with an agent', preview: entity.name };
    case 'attended-call':
      return { title: 'You attended a call', preview: entity.name };
  }
}

function EventIcon(props: { entity: EntityData }) {
  return (
    <Show
      when={
        props.entity.type === 'channel_thread'
          ? props.entity.senderId
          : undefined
      }
      fallback={
        <EntityIcon targetType={getEntityIconType(props.entity)} size="xs" />
      }
    >
      {(senderId) => (
        <div class="size-4">
          <UserIcon
            id={senderId()}
            size="fill"
            suppressClick
            showTooltip={false}
          />
        </div>
      )}
    </Show>
  );
}

/**
 * A single entity-derived activity row: icon, "actor verb location" title,
 * one-line content preview, and a relative timestamp. Clicking opens the
 * underlying entity (channel rows open at the specific message).
 */
export function EntityEventRow(props: {
  item: EntityEvent;
  resolveChannel: (channelId: string) => ChannelEntity | undefined;
}) {
  const text = createMemo(() => eventText(props.item, props.resolveChannel));

  const open = (openInNewSplit: boolean) => {
    void openEntityInSplitFromUnifiedList(props.item.entity, {
      openInNewSplit,
    });
  };

  return (
    <div
      class={cn(
        'group/event @container/event-row flex items-center gap-2.5 px-3 py-2 min-w-0 overflow-hidden',
        'cursor-pointer hover:bg-ink-muted/6'
      )}
      onClick={(e) => open(e.shiftKey)}
    >
      <span class="size-4 shrink-0 flex items-center justify-center [&_svg]:size-3.5">
        <EventIcon entity={props.item.entity} />
      </span>
      <span class="ph-no-capture min-w-0 shrink truncate text-xs text-ink">
        {text().title}
      </span>
      <Show when={text().preview?.trim()}>
        {(preview) => (
          <span class="hidden @md/event-row:inline flex-1 min-w-0 overflow-hidden ph-no-capture truncate text-xs text-ink-muted/60">
            <StaticMarkdown markdown={preview()} singleLine />
          </span>
        )}
      </Show>
      <span class="shrink-0 ml-auto text-ink-extra-muted text-xs tabular-nums">
        {formatDistanceToNowStrict(new Date(props.item.ts), {
          addSuffix: true,
        })}
      </span>
    </div>
  );
}

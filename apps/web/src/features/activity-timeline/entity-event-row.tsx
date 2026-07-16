import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { UserIcon } from '@core/component/UserIcon';
import { useEmail, useUserId } from '@core/context/user';
import type { ChannelEntity, EmailEntity, EntityData } from '@entity';
import ArrowBendUpLeftIcon from '@phosphor/arrow-bend-up-left.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import FolderSimpleIcon from '@phosphor/folder-simple.svg';
import NotePencilIcon from '@phosphor/note-pencil.svg';
import PaperPlaneTiltIcon from '@phosphor/paper-plane-tilt.svg';
import PhoneIcon from '@phosphor/phone.svg';
import PlusCircleIcon from '@phosphor/plus-circle.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Avatar } from '@ui';
import { type Component, createMemo, type JSX, Show } from 'solid-js';
import type { TimelineRow } from './collapse';
import { Emph, FeedRow, LineBody, StackedBody } from './feed-row';
import type { EntityEventVerb, EntityTimelineItem } from './timeline-types';

const VERB_BADGES: Record<EntityEventVerb, Component> = {
  'sent-message': ChatTextIcon,
  'replied-in-thread': ArrowBendUpLeftIcon,
  'sent-email': PaperPlaneTiltIcon,
  'drafted-email': EnvelopeSimpleIcon,
  'email-activity': EnvelopeSimpleIcon,
  'created-document': PlusCircleIcon,
  'edited-document': NotePencilIcon,
  'created-task': CheckSquareIcon,
  'edited-task': CheckSquareIcon,
  'created-folder': FolderSimpleIcon,
  'agent-chat': SparkleIcon,
  'attended-call': PhoneIcon,
};

const MAX_RECIPIENT_NAMES = 2;

/**
 * "Alice, Bob +2" — the thread's participants other than the user's own
 * address, for "Sent an email to …" titles.
 */
function recipientsLabel(
  entity: EmailEntity,
  myEmail: string | undefined
): string | undefined {
  const others = (entity.participants ?? []).filter(
    (participant) => participant.email.toLowerCase() !== myEmail?.toLowerCase()
  );
  if (others.length === 0) return undefined;
  const names = others
    .slice(0, MAX_RECIPIENT_NAMES)
    .map((participant) => participant.name?.trim() || participant.email);
  const overflow = others.length - MAX_RECIPIENT_NAMES;
  return overflow > 0 ? `${names.join(', ')} +${overflow}` : names.join(', ');
}

function emailBody(entity: EmailEntity): JSX.Element {
  return (
    <span class="block min-w-0 truncate">
      <span class="text-ink">{entity.name}</span>
      <Show when={entity.snippet}>
        <span class="text-ink-extra-muted"> — {entity.snippet}</span>
      </Show>
    </span>
  );
}

type Presented = {
  title: JSX.Element;
  body?: JSX.Element;
};

function present(args: {
  items: EntityTimelineItem[];
  resolveChannel: (channelId: string) => ChannelEntity | undefined;
  myEmail: string | undefined;
}): Presented {
  const { items, resolveChannel, myEmail } = args;
  const first = items[0]!;
  const entity = first.entity;
  const count = items.length;

  const channelLabel = (): JSX.Element => {
    if (entity.type !== 'channel_thread') return 'a channel';
    const channel = resolveChannel(entity.channelId);
    if (!channel) return 'a channel';
    if (channel.channelType === 'direct_message') {
      return channel.name.trim() ? (
        <Emph>{channel.name}</Emph>
      ) : (
        'a direct message'
      );
    }
    return channel.name.trim() ? (
      <Emph>#{channel.name.replace(/^#/, '')}</Emph>
    ) : (
      'a channel'
    );
  };

  const messageBodies = (): string[] =>
    items.map((item) =>
      item.entity.type === 'channel_thread' && item.entity.content.trim()
        ? item.entity.content
        : '*sent an attachment*'
    );

  const body = (lines: string[]): JSX.Element | undefined => {
    if (lines.length === 0) return undefined;
    if (lines.length === 1) return <LineBody text={lines[0]!} />;
    return <StackedBody lines={lines} />;
  };

  switch (first.verb) {
    case 'sent-message':
      return {
        title:
          count === 1 ? (
            <>
              <Emph>You</Emph> to {channelLabel()}
            </>
          ) : (
            <>
              <Emph>You</Emph> sent {count} messages in {channelLabel()}
            </>
          ),
        body: body(messageBodies()),
      };
    case 'replied-in-thread':
      return {
        title:
          count === 1 ? (
            <>
              <Emph>You</Emph> replied in a thread in {channelLabel()}
            </>
          ) : (
            <>
              <Emph>You</Emph> replied in {count} threads in {channelLabel()}
            </>
          ),
        // The thread row's content is the root message (possibly someone
        // else's) — show it as context for what was replied to.
        body: body(messageBodies()),
      };
    case 'sent-email': {
      const recipients =
        entity.type === 'email' ? recipientsLabel(entity, myEmail) : undefined;
      return {
        title: recipients ? (
          <>
            Sent an email to <Emph>{recipients}</Emph>
          </>
        ) : (
          'Sent an email'
        ),
        body: entity.type === 'email' ? emailBody(entity) : undefined,
      };
    }
    case 'drafted-email': {
      const recipients =
        entity.type === 'email' ? recipientsLabel(entity, myEmail) : undefined;
      return {
        title: recipients ? (
          <>
            Drafted an email to <Emph>{recipients}</Emph>
          </>
        ) : (
          'Drafted an email'
        ),
        body: entity.type === 'email' ? emailBody(entity) : undefined,
      };
    }
    case 'email-activity': {
      const sender =
        entity.type === 'email'
          ? entity.senderName?.trim() || entity.senderEmail
          : undefined;
      return {
        title: (
          <>
            <Emph>{sender ?? 'Someone'}</Emph> emailed
          </>
        ),
        body: entity.type === 'email' ? emailBody(entity) : undefined,
      };
    }
    case 'created-document':
      return {
        title: (
          <>
            <Emph>You</Emph> created <Emph>“{entity.name}”</Emph>
          </>
        ),
      };
    case 'edited-document':
      // No diff available — there is no server-side edit log, only the fact
      // that the document changed since creation.
      return {
        title: (
          <>
            <Emph>You</Emph> edited <Emph>“{entity.name}”</Emph>
          </>
        ),
      };
    case 'created-task':
      return {
        title: (
          <>
            <Emph>You</Emph> created task <Emph>{entity.name}</Emph>
          </>
        ),
      };
    case 'edited-task':
      return {
        title: (
          <>
            <Emph>You</Emph> updated task <Emph>{entity.name}</Emph>
          </>
        ),
      };
    case 'created-folder':
      return {
        title: (
          <>
            <Emph>You</Emph> created folder <Emph>{entity.name}</Emph>
          </>
        ),
      };
    case 'agent-chat':
      return {
        title: (
          <>
            <Emph>You</Emph> worked with an agent
          </>
        ),
        body: <LineBody text={entity.name} />,
      };
    case 'attended-call':
      return {
        title: (
          <>
            <Emph>You</Emph> attended a call
          </>
        ),
        body: entity.name.trim() ? <LineBody text={entity.name} /> : undefined,
      };
  }
}

function EventAvatar(props: { entity: EntityData }) {
  const userId = useUserId();

  // Shared-email rows (Firehose) belong to the sender, who may not be a
  // Macro user — initials avatar. Everything else in these feeds is the
  // current user's own action.
  const emailSender = () => {
    if (props.entity.type !== 'email') return undefined;
    const sender =
      props.entity.senderName?.trim() || props.entity.senderEmail?.trim();
    return sender || undefined;
  };

  return (
    <Show
      when={emailSender()}
      fallback={
        <Show
          when={userId()}
          fallback={<span class="size-4 rounded-full bg-ink/10" />}
        >
          {(id) => (
            <UserIcon id={id()} size="fill" suppressClick showTooltip={false} />
          )}
        </Show>
      }
    >
      {(sender) => (
        <Avatar size="fill">
          <Avatar.Fallback>
            {sender().slice(0, 1).toUpperCase()}
          </Avatar.Fallback>
        </Avatar>
      )}
    </Show>
  );
}

/**
 * A feed row for one entity-derived event, or a collapsed run of them
 * ("You sent 5 messages in #squad"). Clicking opens the newest underlying
 * entity — channel rows open at the specific message.
 */
export function EntityEventFeedRow(props: {
  row: TimelineRow;
  resolveChannel: (channelId: string) => ChannelEntity | undefined;
  connector: boolean;
  /** Whether email rows are the user's own (Things I did) — shows own avatar. */
  ownActions?: boolean;
}) {
  const email = useEmail();

  const items = createMemo(() =>
    props.row.items.flatMap((item) =>
      item.kind === 'entity-event' ? [item] : []
    )
  );
  const first = () => items()[0]!;

  const presented = createMemo(() =>
    present({
      items: items(),
      resolveChannel: props.resolveChannel,
      myEmail: email(),
    })
  );

  const badge = () => {
    const Icon = VERB_BADGES[first().verb];
    return <Icon />;
  };

  // "Things I did" email rows are the user's own sends — show their avatar,
  // not sender initials.
  const avatarEntity = createMemo((): EntityData => {
    const entity = first().entity;
    if (props.ownActions && entity.type === 'email') {
      return { ...entity, senderName: undefined, senderEmail: undefined };
    }
    return entity;
  });

  return (
    <FeedRow
      avatar={<EventAvatar entity={avatarEntity()} />}
      badge={badge()}
      title={presented().title}
      body={presented().body}
      ts={props.row.ts}
      connector={props.connector}
      onClick={(e) => {
        void openEntityInSplitFromUnifiedList(first().entity, {
          openInNewSplit: e.shiftKey,
        });
      }}
    />
  );
}

import { Entity, type EntityData, isTaskEntity } from '@entity';
import AlarmIcon from '@phosphor/alarm.svg';
import ArticleIcon from '@phosphor/article.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import HashIcon from '@phosphor/hash.svg';
import LightningIcon from '@phosphor/lightning.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import PhoneIcon from '@phosphor/phone.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import UsersIcon from '@phosphor/users.svg';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

/** Profile and model avatars, with Phosphor glyphs for other item types. */
export function HomeEntityIcon(props: { entity: EntityData }) {
  const icon = () =>
    match(props.entity)
      .with({ type: 'document' }, (entity) =>
        isTaskEntity(entity) ? ListChecksIcon : ArticleIcon
      )
      .with(
        { type: 'channel' },
        { type: 'channel_message' },
        { type: 'channel_thread' },
        (entity) =>
          entity.channelType === 'direct_message' ? ChatsIcon : HashIcon
      )
      .with({ type: 'email' }, () => EnvelopeIcon)
      .with({ type: 'chat' }, { type: 'agent_session' }, () => SparkleIcon)
      .with({ type: 'project' }, () => FolderIcon)
      .with({ type: 'calendar_event' }, () => CalendarIcon)
      .with({ type: 'reminder' }, () => AlarmIcon)
      .with({ type: 'call' }, () => PhoneIcon)
      .with({ type: 'automation' }, () => LightningIcon)
      .with({ type: 'foreign' }, () => GitPullRequestIcon)
      .with({ type: 'crm_company' }, () => BuildingsIcon)
      .with({ type: 'crm_contact' }, () => UsersIcon)
      .exhaustive();
  return (
    <span
      class="flex size-5 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <Show
        when={
          props.entity.type === 'chat' ||
          (props.entity.type === 'channel' &&
            props.entity.channelType === 'direct_message')
        }
        fallback={<Dynamic component={icon()} class="size-4 shrink-0" />}
      >
        <span
          class={
            props.entity.type === 'chat'
              ? 'size-4'
              : 'size-5 overflow-hidden rounded-full'
          }
        >
          <Entity.Icon
            entity={props.entity}
            suppressClick
            showTooltip={false}
          />
        </span>
      </Show>
    </span>
  );
}

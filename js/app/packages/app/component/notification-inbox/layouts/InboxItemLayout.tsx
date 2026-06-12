import { EntityIcon } from '@core/component/EntityIcon';
import GithubIcon from '@icon/mcp-github.svg';
import BellIcon from '@phosphor-icons/core/regular/bell.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat.svg?component-solid';
import FileTextIcon from '@phosphor-icons/core/regular/file-text.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import RobotIcon from '@phosphor-icons/core/regular/robot.svg?component-solid';
import UserPlusIcon from '@phosphor-icons/core/regular/user-plus.svg?component-solid';
import { Match, Show, Switch } from 'solid-js';
import { InboxItem, useInboxItem } from '../InboxItem';

function ContentPreview() {
  const { item } = useInboxItem();

  return (
    <Show when={item().content}>
      {(content) => <InboxItem.Content>{content()}</InboxItem.Content>}
    </Show>
  );
}

function ContextLine(props: { label?: string }) {
  const { item } = useInboxItem();

  return (
    <Show when={item().context || props.label}>
      <InboxItem.Context>
        <Show when={props.label}>
          {(label) => <InboxItem.Pill>{label()}</InboxItem.Pill>}
        </Show>
        <Show when={item().context}>
          {(context) => <InboxItem.Content>{context()}</InboxItem.Content>}
        </Show>
      </InboxItem.Context>
    </Show>
  );
}

function EmailLayout() {
  return (
    <>
      <InboxItem.Icon>
        <EntityIcon targetType="email" size="sm" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
        <ContentPreview />
      </InboxItem.Body>
    </>
  );
}

function GithubLayout() {
  return (
    <>
      <InboxItem.Icon>
        <GithubIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
        <ContextLine label="GitHub" />
      </InboxItem.Body>
    </>
  );
}

function ChannelLayout() {
  return (
    <>
      <InboxItem.Icon>
        <ChatIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
        <ContentPreview />
      </InboxItem.Body>
    </>
  );
}

function InviteLayout() {
  return (
    <>
      <InboxItem.Icon>
        <UserPlusIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
        <ContextLine label="Invite" />
      </InboxItem.Body>
      <InboxItem.Trailing>
        <span class="text-xs font-medium text-accent">Accept</span>
      </InboxItem.Trailing>
    </>
  );
}

function TaskLayout() {
  return (
    <>
      <InboxItem.Icon>
        <EntityIcon targetType="task" size="sm" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
      </InboxItem.Body>
    </>
  );
}

function DocumentLayout() {
  const { item } = useInboxItem();

  return (
    <>
      <InboxItem.Icon>
        <FileTextIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
        <InboxItem.CompactContext>
          <InboxItem.Pill>Document</InboxItem.Pill>
          <Show when={item().context}>
            {(context) => <InboxItem.Content>{context()}</InboxItem.Content>}
          </Show>
        </InboxItem.CompactContext>
      </InboxItem.Body>
    </>
  );
}

function AiLayout() {
  return (
    <>
      <InboxItem.Icon>
        <RobotIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
        <ContentPreview />
      </InboxItem.Body>
    </>
  );
}

function CallLayout() {
  return (
    <>
      <InboxItem.Icon>
        <PhoneIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
      </InboxItem.Body>
      <InboxItem.Trailing>
        <span class="text-xs font-medium text-accent">Join</span>
      </InboxItem.Trailing>
    </>
  );
}

function UnknownLayout() {
  return (
    <>
      <InboxItem.Icon>
        <BellIcon class="size-4" />
      </InboxItem.Icon>
      <InboxItem.Body>
        <InboxItem.Summary />
        <ContentPreview />
      </InboxItem.Body>
    </>
  );
}

export function InboxItemLayout() {
  const { item } = useInboxItem();
  const notificationType = () => item().notificationType;
  const isGithub = () => {
    switch (notificationType()) {
      case 'github_pr_status_changed':
      case 'github_review_requested':
      case 'github_pr_comment':
      case 'github_pr_mention':
      case 'github_pr_review':
        return true;
      default:
        return false;
    }
  };

  return (
    <Switch fallback={<UnknownLayout />}>
      <Match when={notificationType() === 'new_email'}>
        <EmailLayout />
      </Match>
      <Match when={isGithub()}>
        <GithubLayout />
      </Match>
      <Match
        when={
          notificationType() === 'channel_mention' ||
          notificationType() === 'channel_message_send' ||
          notificationType() === 'channel_message_reply'
        }
      >
        <ChannelLayout />
      </Match>
      <Match
        when={
          notificationType() === 'channel_invite' ||
          notificationType() === 'invite_to_team'
        }
      >
        <InviteLayout />
      </Match>
      <Match when={notificationType() === 'task_assigned'}>
        <TaskLayout />
      </Match>
      <Match
        when={
          notificationType() === 'document_mention' ||
          notificationType() === 'mentioned_in_document_comment' ||
          notificationType() === 'replied_to_document_comment_thread' ||
          notificationType() === 'commented_on_document'
        }
      >
        <DocumentLayout />
      </Match>
      <Match when={notificationType() === 'ai_response'}>
        <AiLayout />
      </Match>
      <Match when={notificationType() === 'call-started'}>
        <CallLayout />
      </Match>
    </Switch>
  );
}

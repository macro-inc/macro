import { HoverCard } from '@core/component/HoverCard';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { Avatar } from '@ui/components/Avatar';
import { Button } from '@ui/components/Button';
import { UserMessageBubble } from '@ui/components/UserMessageBubble';
import { createSignal, For, type JSX, Show } from 'solid-js';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../core/homepage-demo-people';

export type HomepageMessage = {
  person: HomepagePersonId;
  text: JSX.Element;
  reaction?: { emoji: string; label: string };
  reply?: JSX.Element;
};

export function HomepagePersonAvatar(props: { person: HomepagePersonId }) {
  const person = () => homepagePeople[props.person];
  return (
    <Show
      when={props.person === 'claude' || props.person === 'cursor'}
      fallback={
        <Avatar size="lg" highlightEdge>
          <Avatar.Image src={person().photo} alt="" />
          <Avatar.Fallback>{person().initials}</Avatar.Fallback>
        </Avatar>
      }
    >
      <span class="homepage-agent-avatar" data-agent={props.person}>
        <Show
          when={props.person === 'claude'}
          fallback={<CursorIcon class="size-4" />}
        >
          <ClaudeIcon class="size-4" />
        </Show>
      </span>
    </Show>
  );
}

function Message(props: { message: HomepageMessage }) {
  const person = () => homepagePeople[props.message.person];
  const [reacted, setReacted] = createSignal(false);

  return (
    <li
      class="homepage-message homepage-enter"
      data-side={props.message.person === 'jacob' ? 'self' : 'peer'}
    >
      <span class="homepage-message-name">
        {person().shortName}
        <Show
          when={
            props.message.person === 'claude' ||
            props.message.person === 'cursor'
          }
        >
          <span class="homepage-agent-label">Agent</span>
        </Show>
      </span>
      <HoverCard
        triggerAs="div"
        triggerTabIndex={0}
        triggerAriaLabel={`About ${person().name}`}
        triggerClass="homepage-message-person rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ink/50"
        placement="top-start"
        openDelay={180}
        closeDelay={150}
        trigger={<HomepagePersonAvatar person={props.message.person} />}
        content={
          <div class="workspace-demo glass flex items-center gap-3 rounded-2xl bg-panel p-4 text-sm text-ink shadow-lg">
            <HomepagePersonAvatar person={props.message.person} />
            <div class="flex flex-col gap-1">
              <span>{person().name}</span>
              <span class="text-xs text-ink-muted">
                {props.message.person === 'cursor'
                  ? 'Investigating and fixing the invite flow'
                  : props.message.person === 'claude'
                    ? 'Working from the team’s shared context'
                    : '#launch · Macro'}
              </span>
            </div>
          </div>
        }
      />
      <div class="homepage-message-body">
        <UserMessageBubble
          class={props.message.person === 'jacob' ? undefined : 'glass'}
        >
          <p class="m-0">{props.message.text}</p>
        </UserMessageBubble>
      </div>
      <Show when={props.message.reaction}>
        {(reaction) => (
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="homepage-message-reaction gap-1.5 rounded-full px-2.5 text-xs"
            aria-label={`${reaction().label} reaction to ${person().shortName}'s message`}
            aria-pressed={reacted()}
            onClick={() => setReacted((previous) => !previous)}
          >
            <span aria-hidden="true">{reaction().emoji}</span>
            <span>{reacted() ? 2 : 1}</span>
          </Button>
        )}
      </Show>
      <Show when={props.message.reply}>
        <div class="homepage-message-reply">{props.message.reply}</div>
      </Show>
    </li>
  );
}

export function HomepageConversation(props: {
  messages: readonly HomepageMessage[];
}) {
  return (
    <ol
      class="homepage-conversation workspace-demo"
      aria-label="Launch conversation"
    >
      <For each={props.messages}>
        {(message) => <Message message={message} />}
      </For>
    </ol>
  );
}

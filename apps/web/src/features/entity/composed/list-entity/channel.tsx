import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  singleLineMarkdownTheme,
  twoLineClampMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { DisplayName } from '@entity/components/DisplayName';
import PhoneIcon from '@icon/wide-call.svg';
import { useActiveCallsQuery } from '@queries/call/call';
import { useJoinChannelMutation } from '@queries/channel/join-links';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { Entity } from '../../entity';
import { SearchContent } from '../../extractors-search/search-content';
import { SearchSender } from '../../extractors-search/search-sender';
import type { ChannelEntity, ChannelMessageEntity } from '../../types/entity';
import { firstContentHit } from './shared';

/**
 * Join affordance for a channel row the viewer is not a participant of (team
 * channels of their teams, surfaced in the Channels → Teams tab). Joins via
 * `POST /channels/{channel_id}/join`; on success the soup refetch flips
 * `isParticipant` and the button disappears.
 */
export function ChannelJoinButton(props: {
  entity: ChannelEntity;
  class?: string;
}) {
  const joinMutation = useJoinChannelMutation();

  return (
    <Button
      type="button"
      variant="accent"
      size="sm"
      class={props.class ?? 'shrink-0'}
      disabled={joinMutation.isPending}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        joinMutation.mutate({ channelId: props.entity.id });
      }}
    >
      {joinMutation.isPending ? 'Joining…' : 'Join'}
    </Button>
  );
}

/**
 * Accent phone icon shown on a channel row while a call is live in it. Reads
 * the shared all-active-calls query, so every row dedupes into one request.
 */
export function ChannelActiveCallBadge(props: { channelId: string }) {
  const activeCallsQuery = useActiveCallsQuery();
  const hasActiveCall = () =>
    (activeCallsQuery.data ?? []).some((c) => c.channelId === props.channelId);

  return (
    <Show when={hasActiveCall()}>
      <PhoneIcon class="size-4 shrink-0 text-accent fill-accent" />
    </Show>
  );
}

function ChannelMessage(props: {
  message: NonNullable<ChannelEntity['latestMessage']>;
}) {
  const hasContent = () => Boolean(props.message.content?.trim());
  return (
    <>
      <span class="ph-no-capture font-medium truncate min-w-min max-w-1/3 shrink-0">
        <DisplayName id={props.message.senderId} format="firstName" />
      </span>
      <span class="ph-no-capture text-ink/50 font-medium truncate inline-flex items-center shrink min-w-0">
        <Show
          when={hasContent()}
          fallback={<span class="italic">Attached Items</span>}
        >
          <StaticMarkdown
            theme={singleLineMarkdownTheme}
            markdown={props.message.content}
            singleLine
          />
        </Show>
      </span>
    </>
  );
}

/**
 * One-line channel-message row content: channel name, sender, then the
 * message text (or its highlighted hit). Shared by the narrow and
 * single-line row layouts.
 */
export function ChannelMessageSingleLine(props: {
  entity: ChannelMessageEntity;
}) {
  const hit = () => firstContentHit(props.entity);
  return (
    <span class="flex items-center gap-1 min-w-0 truncate">
      <span class="shrink-0 text-ink-muted text-xs whitespace-nowrap">
        {props.entity.channelName}
      </span>
      <Show when={props.entity.senderId}>
        {(id) => <UserIcon id={id()} size="sm" />}
      </Show>
      <Show when={hit()}>
        {(h) => (
          <span class="shrink-0 text-ink-extra-muted text-xs whitespace-nowrap">
            <SearchSender hit={h()} />
          </span>
        )}
      </Show>
      <span class="text-ink/50 font-normal truncate min-w-0">
        <Show when={hit()} fallback={props.entity.content}>
          {(h) => <SearchContent hit={h()} singleLine />}
        </Show>
      </span>
    </span>
  );
}

export function ChannelMessageNarrowBody(props: {
  entity: ChannelMessageEntity;
}) {
  const hit = () => firstContentHit(props.entity);
  return (
    <Entity.Slot placement="body" class="flex flex-col pb-2 min-h-[2lh] pr-4">
      <Show when={hit()}>
        {(h) => (
          <>
            <span class="text-ink-muted text-xs flex items-center gap-1">
              <Show when={props.entity.senderId}>
                {(id) => <UserIcon id={id()} size="sm" />}
              </Show>
              <SearchSender hit={h()} />
            </span>
            <span class="text-ink-extra-muted truncate">
              <SearchContent hit={h()} />
            </span>
          </>
        )}
      </Show>
    </Entity.Slot>
  );
}

export function ChannelLatestMessageNarrowBody(props: {
  message: NonNullable<ChannelEntity['latestMessage']>;
}) {
  return (
    <Entity.Slot
      placement="body"
      class="text-ink-extra-muted line-clamp-2 pb-2 min-h-[2lh] pr-4"
    >
      <Show
        when={props.message.content?.trim()}
        fallback={<span class="italic">Attached Items</span>}
      >
        <span class="ph-no-capture font-medium text-ink-muted">
          <DisplayName id={props.message.senderId} format="firstName" />:{' '}
        </span>
        <StaticMarkdown
          theme={twoLineClampMarkdownTheme}
          markdown={props.message.content.trim()}
          singleLine
        />
      </Show>
    </Entity.Slot>
  );
}

export function ChannelMessageWideContent(props: {
  entity: ChannelMessageEntity;
}) {
  const hit = () => firstContentHit(props.entity);
  return (
    <>
      <span class="shrink-0 flex gap-1.5 items-center">
        <span class="text-ink-muted whitespace-nowrap">
          {props.entity.channelName}
        </span>
        <Show when={props.entity.senderId}>
          {(id) => <UserIcon id={id()} size="sm" />}
        </Show>
        <Show when={hit()}>
          {(h) => (
            <span class="text-ink-extra-muted text-xs whitespace-nowrap">
              <SearchSender hit={h()} />
            </span>
          )}
        </Show>
      </span>
      <div class="text-ink/50 font-medium flex-1 min-w-0 overflow-hidden">
        <Show when={hit()} fallback={props.entity.content}>
          {(h) => <SearchContent hit={h()} singleLine />}
        </Show>
      </div>
    </>
  );
}

export function ChannelWideContent(props: {
  entity: ChannelEntity;
  showLatestMessage: boolean;
}) {
  return (
    <Show
      when={props.showLatestMessage && props.entity.latestMessage}
      fallback={
        <span class="truncate flex gap-2">
          <Entity.Title entity={props.entity} />
        </span>
      }
    >
      {(msg) => (
        <>
          <span class="w-(--title-width) shrink-0 truncate flex gap-2">
            <Entity.Title entity={props.entity} />
          </span>
          <ChannelMessage message={msg()} />
        </>
      )}
    </Show>
  );
}

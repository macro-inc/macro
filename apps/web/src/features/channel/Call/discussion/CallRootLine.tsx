import { getCallJoinTab } from '@channel/Call/call-tabs';
import { useCall } from '@channel/Call/use-call';
import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { callDuration } from '@channel/core/system-activity';
import { UserGroup } from '@core/component/UserGroup';
import { fireAndForget } from '@core/util/fireAndForget';
import PhoneFillIcon from '@icon/system/fill/phone-fill.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { useLiveCallRecordQuery } from '@queries/call/call';
import type { CallEntryStatus, Message } from '@service-storage/messages';
import { Button } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { formatCallElapsed } from './format-call-elapsed';
import { callerName, PastCallLine } from './PastCallLine';

/** The parts every live call row shows: who started it, for how long, who's on. */
function LiveCallLine(props: {
  message: Message;
  action?: JSX.Element;
  ref?: (element: HTMLElement) => void;
}) {
  const record = useLiveCallRecordQuery(() => props.message.id);
  const [nowMs, setNowMs] = createSignal(Date.now());
  const timer = globalThis.setInterval(() => setNowMs(Date.now()), 1000);
  onCleanup(() => globalThis.clearInterval(timer));
  const elapsed = createMemo(() =>
    formatCallElapsed(props.message.created_at, nowMs())
  );
  const liveParticipants = createMemo(() =>
    record.isSuccess
      ? record.data.participants
          .filter((participant) => !participant.leftAt)
          .map((participant) => participant.userId)
      : []
  );

  return (
    <div
      ref={props.ref}
      class="flex min-h-9 items-center gap-2 pl-(--message-padding-x) pr-2 text-sm text-ink-muted"
      data-message-id={props.message.id}
    >
      <span
        class="flex w-(--user-icon-width) shrink-0 justify-center"
        aria-hidden="true"
      >
        <PhoneFillIcon class="size-4.5 text-success" />
      </span>
      <span class="min-w-0 truncate">
        <span class="font-medium text-ink">{callerName(props.message)}</span>{' '}
        started a call
      </span>
      <span class="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-success">
        <span
          class="size-1.5 rounded-full bg-success animate-pulse"
          aria-hidden="true"
        />
        {elapsed()}
      </span>
      <Show when={liveParticipants().length > 0}>
        <UserGroup
          userIds={liveParticipants()}
          maxUsers={4}
          size="sm"
          suppressClick
          showTooltip
        />
      </Show>
      <Show when={props.action}>
        <span class="ml-auto shrink-0">{props.action}</span>
      </Show>
    </div>
  );
}

/** A live call's row in the channel, where people can get into the call. */
function LiveChannelCallLine(props: {
  channelId: string;
  message: Message;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const { setActiveTab } = useChannelTab();
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
  });
  let observer: IntersectionObserver | undefined;
  onCleanup(() => {
    observer?.disconnect();
    props.onVisibilityChange?.(false);
  });

  return (
    <LiveCallLine
      message={props.message}
      ref={(element) => {
        observer = new IntersectionObserver(([entry]) =>
          props.onVisibilityChange?.(entry.isIntersecting)
        );
        observer.observe(element);
      }}
      action={
        <Show
          when={call.isInThisChannel()}
          fallback={
            <Button
              variant="success"
              size="sm"
              disabled={call.isJoining()}
              onClick={() => fireAndForget(call.joinCall(), 'channel-call')}
            >
              <PhoneIcon class="size-3.5" />
              Join
            </Button>
          }
        >
          <Button
            variant="success"
            size="sm"
            onClick={() => setActiveTab('call')}
          >
            <PhoneIcon class="size-3.5" />
            Return to call
          </Button>
        </Show>
      }
    />
  );
}

/** A channel call's row: the thread's root, drawn as the call rather than a message. */
export function CallRootLine(props: {
  channelId: string;
  message: Message;
  status: CallEntryStatus;
  /** The call panel is already inside the call, so it offers no way in. */
  inCallPanel?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  const ended = () =>
    props.status.state === 'ended' ? props.status : undefined;

  return (
    <Switch>
      <Match when={props.status.state === 'live' && props.inCallPanel}>
        <LiveCallLine message={props.message} />
      </Match>
      <Match when={props.status.state === 'live'}>
        <LiveChannelCallLine
          channelId={props.channelId}
          message={props.message}
          onVisibilityChange={props.onVisibilityChange}
        />
      </Match>
      <Match when={ended()}>
        {(status) => (
          <PastCallLine
            message={props.message}
            verb={`started a call that lasted ${callDuration(status().duration_ms)}`}
            at={props.message.created_at}
          />
        )}
      </Match>
      <Match when={props.status.state === 'record_deleted'}>
        <PastCallLine
          message={props.message}
          verb="started a call"
          at={props.message.created_at}
        />
      </Match>
    </Switch>
  );
}

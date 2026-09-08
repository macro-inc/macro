import Chat from '@phosphor-icons/core/regular/chat-circle.svg?component-solid';
import CheckCircle from '@phosphor-icons/core/regular/check-circle.svg?component-solid';
import Envelope from '@phosphor-icons/core/regular/envelope.svg?component-solid';
import FileText from '@phosphor-icons/core/regular/file-text.svg?component-solid';
import Folder from '@phosphor-icons/core/regular/folder.svg?component-solid';
import Hash from '@phosphor-icons/core/regular/hash.svg?component-solid';
import { createSignal, Match, Show, Switch } from 'solid-js';
import type { NetworkKind } from '../core/activity-network';
import { type EmailReplyState, replyStateLabel } from '../core/email-network';

export function NetworkItemIcon(props: { kind: NetworkKind; task?: boolean }) {
  return (
    <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-current/10 [&>svg]:size-[18px]">
      <Switch fallback={<FileText />}>
        <Match when={props.task}>
          <CheckCircle />
        </Match>
        <Match when={props.kind === 'channel'}>
          <Hash />
        </Match>
        <Match when={props.kind === 'chat'}>
          <Chat />
        </Match>
        <Match when={props.kind === 'email-thread'}>
          <Envelope />
        </Match>
        <Match when={props.kind === 'project'}>
          <Folder />
        </Match>
      </Switch>
    </span>
  );
}

export function NetworkCard(props: {
  name: string;
  kind: NetworkKind;
  block?: string | null;
  count: number;
  date: string;
  selected: boolean;
  replyState?: EmailReplyState;
}) {
  return (
    <span
      class="flex h-[68px] w-[184px] items-center gap-2.5 rounded-xl border border-edge bg-panel px-3 text-left shadow-sm transition-colors hover:border-ink-muted"
      classList={{ 'border-accent! ring-2 ring-accent/15': props.selected }}
    >
      <NetworkItemIcon kind={props.kind} task={props.block === 'task'} />
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="line-clamp-2 text-[13px] font-medium leading-[17px] text-ink">
          {props.name}
        </span>
        <Show
          when={props.replyState && props.replyState !== 'unknown'}
          fallback={
            <span class="truncate text-[10px] text-ink-muted">
              {props.count} {props.count === 1 ? 'action' : 'actions'}{' '}
              <span class="mx-0.5 text-ink-extra-muted">·</span>{' '}
              {new Date(props.date).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          }
        >
          <span
            class="flex items-center gap-1 text-[10px]"
            classList={{
              'text-warning': props.replyState === 'unanswered',
              'text-success':
                props.replyState === 'replied' ||
                props.replyState === 'team-replied',
              'text-ink-muted':
                props.replyState === 'sent' || props.replyState === 'received',
            }}
          >
            <span class="size-1 rounded-full bg-current" />
            {replyStateLabel(props.replyState!)}
          </span>
        </Show>
      </span>
    </span>
  );
}

export function NetworkAvatar(props: {
  name: string;
  picture?: string;
  selected?: boolean;
  isYou?: boolean;
  subtitle?: string;
}) {
  const [failedUrl, setFailedUrl] = createSignal<string>();
  const initials = () =>
    props.name
      .split(/[\s.@]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?';
  return (
    <span class="flex w-[160px] flex-col items-center gap-1.5 text-center">
      <span
        class="flex size-[38px] items-center justify-center overflow-hidden rounded-full border-2 border-panel bg-surface-3 text-xs font-semibold text-ink ring-1 ring-edge"
        classList={{ 'ring-accent! ring-2!': props.selected }}
      >
        <Show
          when={props.picture && props.picture !== failedUrl()}
          fallback={initials()}
        >
          <img
            src={props.picture}
            alt=""
            class="size-full object-cover"
            draggable={false}
            onError={() => setFailedUrl(props.picture)}
          />
        </Show>
      </span>
      <span class="w-full truncate text-[12px] font-medium text-ink">
        {props.name}
        {props.isYou ? ' (you)' : ''}
      </span>
      <Show when={props.subtitle}>
        <span class="w-full truncate text-[10px] text-ink-muted">
          {props.subtitle}
        </span>
      </Show>
    </span>
  );
}

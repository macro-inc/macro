import ChatIcon from '@icon/system/regular/chat-circle.svg';
import KeyIcon from '@icon/system/regular/key.svg';
import PlugIcon from '@icon/system/regular/plugs-connected.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { Avatar, Button } from '@ui';
import { Show } from 'solid-js';
import type { ExternalAgent } from '../core/external-agent';

/** How the agent's events reach its runtime, for the row's subtitle. */
function deliveryLabel(agent: ExternalAgent): string {
  if (!agent.endpoint) return 'Polls for events';
  return agent.endpoint.verified
    ? `Pushes to ${agent.endpoint.url}`
    : `Endpoint not verified · ${agent.endpoint.url}`;
}

export function ExternalAgentRow(props: {
  agent: ExternalAgent;
  busy?: boolean;
  onMessage?: () => void;
  onVerify?: () => void;
  onNewToken: () => void;
  onDelete?: () => void;
}) {
  return (
    <div class="flex items-center gap-4 px-6 py-4 mobile:items-start touch:px-4">
      <Avatar size="lg" class="bg-surface text-accent ring ring-edge-muted">
        <Show
          when={props.agent.avatarUrl}
          fallback={
            <Avatar.Fallback>
              <PlugIcon class="size-5" />
            </Avatar.Fallback>
          }
        >
          {(avatarUrl) => (
            <Avatar.Image
              src={avatarUrl()}
              alt={`${props.agent.name} avatar`}
            />
          )}
        </Show>
      </Avatar>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="truncate text-sm font-medium text-ink">
            {props.agent.name}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.agent.handle}
          </span>
          <span class="shrink-0 rounded-full border border-edge-muted px-2 py-0.5 text-xxs font-medium uppercase text-ink-extra-muted">
            {props.agent.teamId ? 'Team' : 'Private'}
          </span>
        </div>
        <p
          class="mt-0.5 truncate text-xs"
          classList={{
            'text-ink-extra-muted': props.agent.endpoint?.verified !== false,
            'text-alert-ink': props.agent.endpoint?.verified === false,
          }}
        >
          {deliveryLabel(props.agent)}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Show when={props.onMessage}>
          {(onMessage) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.busy}
              aria-label={`Message ${props.agent.name}`}
              onClick={onMessage()}
            >
              <ChatIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
              Message
            </Button>
          )}
        </Show>
        <Show when={props.onVerify}>
          {(onVerify) => (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.busy}
              onClick={onVerify()}
            >
              Verify
            </Button>
          )}
        </Show>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={props.busy}
          aria-label={`New token for ${props.agent.name}`}
          tooltip="New token"
          onClick={props.onNewToken}
        >
          <KeyIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
        </Button>
        <Show when={props.onDelete}>
          {(onDelete) => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="text-negative"
              disabled={props.busy}
              aria-label={`Delete ${props.agent.name}`}
              onClick={onDelete()}
            >
              <TrashIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
          )}
        </Show>
      </div>
    </div>
  );
}

import type { JSX } from 'solid-js';
import { AgentAvatar } from './AgentGlyph';

/** Shared roster presentation; fetching and management actions stay with the host. */
export function AgentRosterRow(props: {
  id: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  coder?: boolean;
  share: 'system' | 'team' | 'private';
  detail: string;
  actions?: JSX.Element;
}) {
  return (
    <div class="arow">
      <AgentAvatar
        agent={{
          id: props.id,
          botId: props.id,
          name: props.name,
          avatarUrl: props.avatarUrl,
        }}
        coder={props.coder ?? false}
      />
      <div class="info">
        <div class="line">
          <span class="nm truncate">{props.name}</span>
          <span class="tag truncate">@{props.handle}</span>
          <span class={props.share === 'system' ? 'badge system' : 'badge'}>
            {props.share}
          </span>
        </div>
        <p class="sub truncate">{props.detail}</p>
      </div>
      <div class="acts">{props.actions}</div>
    </div>
  );
}

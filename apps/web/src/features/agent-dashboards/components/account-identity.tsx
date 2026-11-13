import { AgentTag } from '@core/component/AgentTag';
import type { JSX } from 'solid-js';

/** An account's picture, name, and the agent tag when it is one. */
export function AccountIdentity(props: {
  avatar: JSX.Element;
  name: string;
  isAgent: boolean;
}) {
  return (
    <span class="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
      {props.avatar}
      <span class="min-w-0 truncate">{props.name}</span>
      {props.isAgent ? <AgentTag /> : null}
    </span>
  );
}

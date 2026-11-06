import { AgentTag } from '@core/component/AgentTag';
import type { JSX } from 'solid-js';

/** A Work section's heading: picture, name, and the agent tag. */
export function WorkIdentity(props: {
  avatar: JSX.Element;
  name: string;
  isAgent: boolean;
  /** Something true of this person right now, such as speaking in a call. */
  note?: JSX.Element;
}) {
  return (
    <span class="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
      {props.avatar}
      <span class="min-w-0 truncate">{props.name}</span>
      {props.isAgent ? <AgentTag /> : null}
      {props.note}
    </span>
  );
}

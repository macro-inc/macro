import { AgentThinking } from '@app/features/agent-activity/agent-activity';
import {
  type AwaitDecoratorProps,
  PENDING_REPLY_TEXT,
} from '@macro-inc/lexical-core';
import { type Component, Show } from 'solid-js';

/** Source `importJSON` keeps a stored null text, which renders the default. */
export type AwaitUIProps = Omit<AwaitDecoratorProps, 'text'> & {
  text?: string | null;
};

export const Await: Component<AwaitUIProps> = (props) => {
  return (
    // A chat agent's running reply reads as the working line its runs use.
    <Show when={props.text !== PENDING_REPLY_TEXT} fallback={<AgentThinking />}>
      <span
        class="animate-pulse text-current/50 select-none bg-current/5 rounded-xs"
        inert
        data-await-id={props.awaitId}
      >
        {props.text ?? 'Waiting…'}
      </span>
    </Show>
  );
};

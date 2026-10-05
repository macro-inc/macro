import OpenAiIcon from '@icon/openai.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import GoogleIcon from '@phosphor-fill/google-logo-fill.svg';
import { Match, Switch } from 'solid-js';

/** Production provider glyphs for the local sample catalog. */
export function ModelIcon(props: {
  model?: string | null;
  provider?: 'claude' | 'chatgpt' | 'cursor';
  class?: string;
}) {
  const sizing = () => props.class ?? 'size-4';
  return (
    <Switch fallback={<SparkleIcon class={`shrink-0 ${sizing()}`} />}>
      <Match when={props.provider === 'cursor'}>
        <CursorIcon aria-hidden="true" class={`shrink-0 ${sizing()}`} />
      </Match>
      <Match
        when={props.provider === 'claude' || props.model?.startsWith('claude-')}
      >
        <ClaudeIcon class={`shrink-0 ${sizing()}`} />
      </Match>
      <Match
        when={props.provider === 'chatgpt' || props.model?.startsWith('gpt-')}
      >
        <OpenAiIcon class={`shrink-0 ${sizing()}`} />
      </Match>
      <Match when={props.model?.startsWith('gemini-')}>
        <GoogleIcon class={`shrink-0 ${sizing()}`} />
      </Match>
    </Switch>
  );
}

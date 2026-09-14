import GoogleIcon from '@phosphor-fill/google-logo-fill.svg';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import AnthropicIcon from '../assets/anthropic.svg';
import OpenAiIcon from '../assets/openai.svg';

type Provider = 'anthropic' | 'openai' | 'google';

/** Accept both routed model ids and the bare ids reported by agent runtimes. */
export function modelProvider(
  model: string | null | undefined
): Provider | undefined {
  const id = model?.trim().toLowerCase();
  if (!id) return undefined;
  if (
    id.startsWith('anthropic/') ||
    /^(claude|sonnet|opus|haiku)(-|$)/.test(id)
  )
    return 'anthropic';
  if (
    id.startsWith('openai/') ||
    /^(gpt-|chatgpt-|codex|o[134](?:-|$))/.test(id)
  )
    return 'openai';
  if (id.startsWith('google/') || id.startsWith('gemini')) return 'google';
  return undefined;
}

const icons: Record<
  Provider,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  anthropic: AnthropicIcon,
  openai: OpenAiIcon,
  google: GoogleIcon,
};

/** Unknown/loading providers reserve space instead of showing a misleading logo. */
export function ProviderIcon(props: {
  model?: string | null;
  class?: string;
  animate?: boolean;
}) {
  const provider = () => modelProvider(props.model);
  return (
    <span
      class={`inline-flex shrink-0 ${props.class ?? ''}`}
      classList={{ 'motion-safe:animate-pulse': props.animate }}
      data-ai-provider={provider()}
    >
      <Show when={provider()}>
        {(name) => (
          <Dynamic component={icons[name()]} class="size-full text-ink" />
        )}
      </Show>
    </span>
  );
}

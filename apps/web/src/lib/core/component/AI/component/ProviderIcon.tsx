import ClaudeIcon from '@icon/wide-claude.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import GoogleIcon from '@phosphor-fill/google-logo-fill.svg';
import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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
  anthropic: ClaudeIcon,
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
        {(name) => <Dynamic component={icons[name()]} class="size-full" />}
      </Show>
    </span>
  );
}

/**
 * The logo to show beside a model's name in a picker: its provider's, or a
 * neutral sparkle for a model whose provider the id does not give away.
 */
export function ModelIcon(props: { model?: string | null; class?: string }) {
  const sizing = () => props.class ?? 'size-4';
  return (
    <Show
      when={modelProvider(props.model)}
      fallback={<SparkleIcon class={`shrink-0 ${sizing()}`} />}
    >
      <ProviderIcon model={props.model} class={sizing()} />
    </Show>
  );
}

import MacroGridLoader from '@macro-icons/macro-grid-noise-loader-4.svg';
import { type Component, type JSX, Show } from 'solid-js';
import type { RenderContext } from './ToolRenderer';

export function BaseTool(props: {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  text: string;
  children?: JSX.Element;
  renderContext: RenderContext['renderContext'];
  type: 'call' | 'response';
}) {
  return (
    <div class="relative text-sm text-ink-extra-muted my-3 py-1 border-l pl-4 border-edge">
      <div class="flex gap-x-2 items-center mb-0.5">
        <Show
          when={props.renderContext.isStreaming && props.type === 'call'}
          fallback={
            <props.icon class="h-[20px] w-[20px] shrink-0 text-accent" />
          }
        >
          <MacroGridLoader width={20} height={20} class="text-accent" />
        </Show>
        <div class="p-2">{props.text}</div>
      </div>
      <div class="pl-8">{props.children && props.children}</div>
    </div>
  );
}

import { type Component, type JSX, Show } from 'solid-js';
import type { RenderContext } from './ToolRenderer';

type ToolCallProps = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  renderContext: RenderContext['renderContext'];
  type: 'call';
  children: JSX.Element;
};
type ToolResponseProps = {
  children: JSX.Element;
  renderContext: RenderContext['renderContext'];
  type: 'response';
};

function BaseToolCall(props: ToolCallProps) {
  return (
    <div class="relative text-sm text-ink-extra-muted border-l pl-4 border-edge">
      <div class="flex gap-x-2 items-center">
        <Show when={props.type === 'call'}>
          <props.icon class="h-[20px] w-[20px] shrink-0 text-accent" />
          <div class="p-2">{props.children}</div>
        </Show>
      </div>
    </div>
  );
}

function BaseToolResponse(props: ToolResponseProps) {
  return (
    <div class="relative text-sm text-ink-extra-muted border-l pl-4 border-edge mb-2">
      <div class="pl-8">{props.children && props.children}</div>
    </div>
  );
}

export function BaseTool(props: ToolCallProps | ToolResponseProps) {
  if (props.type === 'call') return BaseToolCall(props);
  return BaseToolResponse(props);
}

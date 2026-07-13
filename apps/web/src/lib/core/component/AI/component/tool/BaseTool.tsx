import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Tool } from './Tool';
import { type RenderContext, useToolError } from './ToolRenderer';

type ToolCallProps = {
  align?: 'center' | 'start';
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  renderContext: RenderContext['renderContext'];
  type: 'call';
  children: JSX.Element;
  response?: JSX.Element;
};
type ToolResponseProps = {
  children: JSX.Element;
  renderContext: RenderContext['renderContext'];
  type: 'response';
};

function BaseToolCall(props: ToolCallProps) {
  const error = useToolError();
  const grouped = () => props.renderContext.grouped === true;

  return (
    <Tool.Root grouped={grouped()} muted={!!error}>
      <Tool.Row
        align={props.align}
        icon={props.icon}
        trailing={error ? <span class="text-ink">Failed</span> : undefined}
      >
        {props.children}
      </Tool.Row>
      <Show when={props.response}>
        <Tool.Response>{props.response}</Tool.Response>
      </Show>
    </Tool.Root>
  );
}

function BaseToolResponse(props: ToolResponseProps) {
  return (
    <Tool.Root>
      <div class="px-3 py-2">{props.children && props.children}</div>
    </Tool.Root>
  );
}

export function BaseTool(props: ToolCallProps | ToolResponseProps) {
  if (props.type === 'call') return BaseToolCall(props);
  return BaseToolResponse(props);
}

import type { Component, JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { match } from 'ts-pattern';
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
  const ending = () => useToolError();
  const reason = () => {
    const current = ending();
    return current?.kind === 'failed'
      ? current.reason?.trim() || undefined
      : undefined;
  };
  const [showReason, setShowReason] = createSignal(false);
  const grouped = () => props.renderContext.grouped === true;
  const trailing = () => {
    const current = ending();
    if (!current) return undefined;
    return match(current)
      .with({ kind: 'failed' }, () => (
        <Tool.ResultToggle
          expanded={showReason()}
          onToggle={() => setShowReason((shown) => !shown)}
          showToggle={reason() !== undefined}
          status={
            <span
              classList={{ 'text-ink': !grouped(), 'text-failure': grouped() }}
            >
              Failed
            </span>
          }
        />
      ))
      .with({ kind: 'stopped' }, () => (
        <span
          classList={{ 'text-xs': !grouped(), 'text-ink-disabled': grouped() }}
        >
          Stopped
        </span>
      ))
      .exhaustive();
  };

  return (
    <Tool.Root grouped={grouped()} muted={ending()?.kind === 'failed'}>
      <Tool.Row
        active={props.renderContext.running}
        align={props.align}
        icon={props.icon}
        trailing={trailing()}
      >
        {props.children}
      </Tool.Row>
      <Show when={props.response}>
        <Tool.Response>{props.response}</Tool.Response>
      </Show>
      <Show when={showReason() && reason()}>
        {(text) => (
          <p
            class="whitespace-pre-wrap break-words pb-2"
            classList={{ 'pl-9 pr-3': !grouped() }}
          >
            {text()}
          </p>
        )}
      </Show>
    </Tool.Root>
  );
}

function BaseToolResponse(props: ToolResponseProps) {
  return (
    <Tool.Root grouped={props.renderContext.grouped}>
      <div class="px-3 py-2">{props.children && props.children}</div>
    </Tool.Root>
  );
}

export function BaseTool(props: ToolCallProps | ToolResponseProps) {
  if (props.type === 'call') return BaseToolCall(props);
  return BaseToolResponse(props);
}

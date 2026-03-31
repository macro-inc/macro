import type { Component } from 'solid-js';
import type {
  NamedTool,
  ToolContext,
  ToolName,
} from '@service-cognition/generated/tools/tool';

export type RenderContext = {
  renderContext: {
    isStreaming: boolean;
  };
};

export type ToolCallContext<TName extends ToolName = ToolName> = ToolContext<
  NamedTool<TName, 'call'>
>;

export type ToolResponseContext<TName extends ToolName = ToolName> =
  ToolContext<NamedTool<TName, 'response'>>;

export type ToolResponseRenderContext<TName extends ToolName = ToolName> = {
  toolCall: ToolCallContext<TName>;
  toolResponse: ToolResponseContext<TName>;
};

export interface ToolRendererHandler<
  TContext extends Record<string, unknown>,
  TRenderContext extends Record<string, unknown>,
> {
  handle?: (context: TContext) => void | Promise<void>;
  render?: Component<TContext & TRenderContext>;
}

export interface AnyToolRenderer<
  TRenderContext extends Record<string, unknown>,
> {
  call: ToolRendererHandler<ToolCallContext, TRenderContext>;
  response: ToolRendererHandler<ToolResponseRenderContext, TRenderContext>;
}

export type ToolRendererMap<TRenderContext extends Record<string, unknown>> =
  Record<ToolName, AnyToolRenderer<TRenderContext>>;

export interface ToolRendererConfig<
  TName extends ToolName,
  TRenderContext extends Record<string, unknown>,
> {
  name: TName;
  renderCall: Component<ToolCallContext<TName> & TRenderContext>;
  renderResponse: Component<ToolResponseRenderContext<TName> & TRenderContext>;
  handleCall?: (context: ToolCallContext<TName>) => void | Promise<void>;
  handleResponse?: (
    context: ToolResponseRenderContext<TName>
  ) => void | Promise<void>;
}

export function createToolRenderer<TName extends ToolName>(
  config: ToolRendererConfig<TName, RenderContext>
): AnyToolRenderer<RenderContext> {
  const callHandler: AnyToolRenderer<RenderContext>['call'] = {
    render: config.renderCall as Component<ToolCallContext & RenderContext>,
    handle: config.handleCall as
      | ((context: ToolCallContext) => void | Promise<void>)
      | undefined,
  };

  const responseHandler: AnyToolRenderer<RenderContext>['response'] = {
    render: config.renderResponse as Component<
      ToolResponseRenderContext & RenderContext
    >,
    handle: config.handleResponse as
      | ((context: ToolResponseRenderContext) => void | Promise<void>)
      | undefined,
  };

  return {
    call: callHandler,
    response: responseHandler,
  };
}

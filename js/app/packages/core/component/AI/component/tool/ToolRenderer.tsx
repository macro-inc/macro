import type {
  NamedTool,
  ToolContext,
  ToolHandler,
  ToolName,
} from '@service-cognition/generated/tools/tool';

export type RenderContext = {
  renderContext: {
    isStreaming: boolean;
  };
};

import type { Component } from 'solid-js';

export interface ToolRendererConfig<TName extends ToolName, RenderContext> {
  name: TName;
  renderCall: Component<ToolContext<NamedTool<TName, 'call'>> & RenderContext>;
  renderResponse: Component<
    ToolContext<NamedTool<TName, 'response'>> & RenderContext
  >;
  handleCall?: (
    context: ToolContext<NamedTool<TName, 'call'>>
  ) => void | Promise<void>;
  handleResponse?: (
    context: ToolContext<NamedTool<TName, 'response'>>
  ) => void | Promise<void>;
}

export function createToolRenderer<TName extends ToolName>(
  config: ToolRendererConfig<TName, RenderContext>
) {
  const callHandler: ToolHandler<NamedTool<TName, 'call'>, RenderContext> = {
    render: config.renderCall,
    handle: config.handleCall,
  };

  const responseHandler: ToolHandler<
    NamedTool<TName, 'response'>,
    RenderContext
  > = {
    render: config.renderResponse,
    handle: config.handleResponse,
  };

  return {
    call: callHandler,
    response: responseHandler,
  };
}

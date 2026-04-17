import { type Component, createContext, useContext } from 'solid-js';
import type {
  NamedTool,
  ToolName,
} from '@service-cognition/generated/tools/tool';

export const ToolErrorContext = createContext<
  (() => string | undefined) | undefined
>();
export const useToolError = () => {
  const accessor = useContext(ToolErrorContext);
  return accessor?.();
};

export type RenderContext = {
  renderContext: {
    isStreaming: boolean;
  };
};

export type ToolContext<TTool extends NamedTool = NamedTool> = {
  tool: TTool;
  chat_id: string;
  message_id: string;
  part_index: number;
  isComplete: boolean;
};

export type ToolRenderContext<TName extends ToolName = ToolName> = ToolContext<
  NamedTool<TName, 'call'>
> & {
  response?: NamedTool<TName, 'response'>;
};

export type ToolHandlerMap<TRenderContext> = {
  [K in ToolName]: ToolHandler<K, TRenderContext>;
};

export interface ToolHandler<TName extends ToolName, TRenderContext> {
  handleCall?: (
    context: ToolContext<NamedTool<TName, 'call'>>
  ) => void | Promise<void>;
  handleResponse?: (
    context: ToolContext<NamedTool<TName, 'response'>>
  ) => void | Promise<void>;
  render: Component<ToolRenderContext<TName> & TRenderContext>;
}

export interface ToolRendererConfig<TName extends ToolName, TRenderContext> {
  name: TName;
  render: Component<ToolRenderContext<TName> & TRenderContext>;
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
  return {
    render: config.render,
    handleCall: config.handleCall,
    handleResponse: config.handleResponse,
  };
}

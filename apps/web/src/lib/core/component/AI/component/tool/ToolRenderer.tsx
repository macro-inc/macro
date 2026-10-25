import type {
  NamedTool,
  ToolName,
} from '@service-cognition/generated/tools/tool';
import { type Component, createContext, useContext } from 'solid-js';

/**
 * A call that ended without a result: it failed, with the tool's own reason
 * when it gave one, or its turn stopped it first.
 */
export type ToolEnding =
  | { kind: 'failed'; reason?: string }
  | { kind: 'stopped' };

export const ToolErrorContext = createContext<
  (() => ToolEnding | undefined) | undefined
>();
export const useToolError = () => {
  const accessor = useContext(ToolErrorContext);
  return accessor?.();
};

export type RenderContext = {
  renderContext: {
    isStreaming: boolean;
    grouped?: boolean;
    /** This call is still running, so its row reads as active. */
    running?: boolean;
    /** Whether a later part of the same assistant turn calls this tool. */
    followedBy: (name: ToolName) => boolean;
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

interface ToolRendererConfig<TName extends ToolName, TRenderContext> {
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

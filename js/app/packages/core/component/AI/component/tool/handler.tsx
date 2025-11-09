import { isErr } from '@core/util/maybeResult';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type NamedTool,
  type ToolContext,
  type ToolHandler,
  type ToolHandlerMap,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import { createStore } from 'solid-js/store';
import { Dynamic, Show } from 'solid-js/web';
import { listDocumentsHandler } from './ListDocuments';
import { listEmailsHandler } from './ListEmails';
import { rewriteHandler } from './MarkdownRewrite';
import { readHandler } from './Read';
import type { RenderContext } from './ToolRenderer';
import { unifiedSearchHandler } from './UnifiedSearch';
import { webSearchHandler } from './WebSearch';

const [renderStore, setRenderStore] = createStore<
  Record<string, 'call' | 'response'>
>({});

const toolHandlers: ToolHandlerMap<RenderContext> = {
  UnifiedSearch: unifiedSearchHandler,
  WebSearch: webSearchHandler,
  MarkdownRewrite: rewriteHandler,
  Read: readHandler,
  ListDocuments: listDocumentsHandler,
  ListEmails: listEmailsHandler,
};

type ToolProps = {
  tool_id: string;
  json: unknown;
  name: string;
  part_index: number;
  chat_id: string;
  message_id: string;
  type: 'call' | 'response' | 'error';
  // TODO: this should be removed. Render one of "call" | "response" | "error"
  isComplete: boolean;
  renderContext: RenderContext;
};

export function RenderTool(props: ToolProps) {
  let handler: ToolHandler<NamedTool, RenderContext>;
  let context: ToolContext<NamedTool>;

  if (props.type === 'call') {
    const maybeTool = deserializeToolCall({
      id: props.tool_id,
      json: props.json,
      name: props.name as ToolName,
    });
    if (isErr(maybeTool)) return null;
    const tool = maybeTool[1];
    setRenderStore(props.tool_id, 'call');
    handler = toolHandlers[tool.name].call;
    const ctx: ToolContext<NamedTool<ToolName, 'call'>> = {
      chat_id: props.chat_id,
      message_id: props.message_id,
      part_index: props.part_index,
      tool,
      isComplete: props.isComplete,
    };
    context = ctx;
  } else if (props.type === 'response') {
    const maybeTool = deserializeToolResponse({
      id: props.tool_id,
      json: props.json,
      name: props.name as ToolName,
    });
    setRenderStore(props.tool_id, 'response');
    if (isErr(maybeTool)) return null;
    const tool = maybeTool[1];
    handler = toolHandlers[tool.name].response;
    const ctx: ToolContext<NamedTool<ToolName, 'response'>> = {
      chat_id: props.chat_id,
      message_id: props.message_id,
      part_index: props.part_index,
      tool,
      isComplete: props.isComplete,
    };
    context = ctx;
  } else {
    return;
  }

  return (
    <Show when={props.type === renderStore[props.tool_id]}>
      <Dynamic
        component={handler.render}
        {...context}
        renderContext={{
          isStreaming: props.renderContext.renderContext.isStreaming,
        }}
      />
    </Show>
  );
}

export async function triggerToolCall(args: Omit<ToolProps, 'renderContext'>) {
  const { tool_id, json, name, chat_id, message_id, part_index, type } = args;

  if (type === 'error') {
    return;
  }

  const maybeTool =
    type === 'call'
      ? deserializeToolCall({
          id: tool_id,
          json,
          name: name as ToolName,
        })
      : deserializeToolResponse({
          id: tool_id,
          json,
          name: name as ToolName,
        });

  if (isErr(maybeTool)) return;

  const tool = maybeTool[1];
  const handler = toolHandlers[tool.name][type];
  if (!handler.handle) return;
  const context: ToolContext<NamedTool> = {
    chat_id,
    message_id,
    part_index,
    tool,
    isComplete: type !== 'call',
  };

  // TODO
  return handler.handle(context as any);
}

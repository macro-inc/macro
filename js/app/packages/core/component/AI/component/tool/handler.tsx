import { isErr } from '@core/util/maybeResult';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { bashCodeExecutionHandler } from './BashCodeExecution';
import { createDocumentHandler } from './CreateDocument';
import { getThreadHandler } from './GetThread';
import { listEntitiesHandler } from './ListEntities';
import { listLabelsHandler } from './ListLabels';
import {
  getEntityPropertiesHandler,
  setEntityPropertyHandler,
} from './Properties';
import { readContentHandler } from './ReadContent';
import { readMetadataHandler } from './ReadMetadata';
import { readThreadHandler } from './ReadThread';
import { contentSearchHandler, nameSearchHandler } from './Search';
import { sendEmailHandler } from './SendEmail';
import { textEditorCodeExecutionHandler } from './TextEditorCodeExecution';
import type {
  RenderContext,
  ToolCallContext,
  ToolRendererMap,
  ToolResponseRenderContext,
} from './ToolRenderer';
import { updateThreadLabelsHandler } from './UpdateThreadLabels';
import { webFetchHandler } from './WebFetch';
import { webSearchHandler } from './WebSearch';

const toolHandlers: ToolRendererMap<RenderContext> = {
  GetEntityProperties: getEntityPropertiesHandler,
  ListEntities: listEntitiesHandler,
  bash_code_execution: bashCodeExecutionHandler,
  ContentSearch: contentSearchHandler,
  CreateDocument: createDocumentHandler,
  GetThread: getThreadHandler,
  ListLabels: listLabelsHandler,
  NameSearch: nameSearchHandler,
  ReadThread: readThreadHandler,
  ReadContent: readContentHandler,
  ReadMetadata: readMetadataHandler,
  SendEmail: sendEmailHandler,
  SetEntityProperty: setEntityPropertyHandler,
  text_editor_code_execution: textEditorCodeExecutionHandler,
  UpdateThreadLabels: updateThreadLabelsHandler,
  web_fetch: webFetchHandler,
  web_search: webSearchHandler,
};

type BaseToolProps = {
  tool_id: string;
  name: string;
  part_index: number;
  chat_id: string;
  message_id: string;
  renderContext: RenderContext;
};

type ToolCallProps = BaseToolProps & {
  type: 'call';
  tool_call: unknown;
};

type ToolResponseProps = BaseToolProps & {
  type: 'response';
  call_part_index: number;
  tool_call: unknown;
  tool_response: unknown;
};

type RenderToolProps = ToolCallProps | ToolResponseProps;

type TriggerToolCallArgs =
  | Omit<ToolCallProps, 'renderContext'>
  | (Omit<
      ToolResponseProps,
      'renderContext' | 'call_part_index' | 'tool_call'
    > & {
      type: 'response';
    });

const pendingToolCalls = new Map<string, ToolCallContext>();

function createCallContext(args: {
  tool_id: string;
  tool_call: unknown;
  name: string;
  part_index: number;
  chat_id: string;
  message_id: string;
}): ToolCallContext | null {
  const maybeTool = deserializeToolCall({
    id: args.tool_id,
    json: args.tool_call,
    name: args.name as ToolName,
  });

  if (isErr(maybeTool)) return null;

  return {
    chat_id: args.chat_id,
    isComplete: true,
    message_id: args.message_id,
    part_index: args.part_index,
    tool: maybeTool[1],
  };
}

function createResponseContext(args: {
  tool_id: string;
  tool_call: unknown;
  tool_response: unknown;
  name: string;
  call_part_index: number;
  part_index: number;
  chat_id: string;
  message_id: string;
}): ToolResponseRenderContext | null {
  const toolCall = createCallContext({
    chat_id: args.chat_id,
    message_id: args.message_id,
    name: args.name,
    part_index: args.call_part_index,
    tool_call: args.tool_call,
    tool_id: args.tool_id,
  });

  if (!toolCall) return null;

  const maybeToolResponse = deserializeToolResponse({
    id: args.tool_id,
    json: args.tool_response,
    name: args.name as ToolName,
  });

  if (isErr(maybeToolResponse)) return null;

  return {
    toolCall,
    toolResponse: {
      chat_id: args.chat_id,
      isComplete: true,
      message_id: args.message_id,
      part_index: args.part_index,
      tool: maybeToolResponse[1],
    },
  };
}

function renderWithContext<TContext extends Record<string, unknown>>(
  handler:
    | {
        render?: Component<TContext & RenderContext>;
      }
    | undefined,
  context: TContext,
  renderContext: RenderContext
) {
  if (!handler?.render) return null;

  return (
    <Dynamic
      component={handler.render}
      {...context}
      renderContext={{
        isStreaming: renderContext.renderContext.isStreaming,
      }}
    />
  );
}

export function RenderToolCall(props: ToolCallProps) {
  const context = createCallContext(props);
  if (!context) return null;

  return renderWithContext(
    toolHandlers[context.tool.name].call,
    context,
    props.renderContext
  );
}

export function RenderToolResponse(props: ToolResponseProps) {
  const context = createResponseContext(props);
  if (!context) return null;

  return renderWithContext(
    toolHandlers[context.toolResponse.tool.name].response,
    context,
    props.renderContext
  );
}

export function RenderTool(props: RenderToolProps) {
  if (props.type === 'call') {
    return <RenderToolCall {...props} />;
  }

  return <RenderToolResponse {...props} />;
}

export async function triggerToolCall(args: TriggerToolCallArgs) {
  if (args.type === 'call') {
    const context = createCallContext(args);
    if (!context) return;

    pendingToolCalls.set(context.tool.id, context);
    return toolHandlers[context.tool.name].call.handle?.(context);
  }

  const toolCall = pendingToolCalls.get(args.tool_id);
  if (!toolCall) return;

  const context = createResponseContext({
    chat_id: args.chat_id,
    message_id: args.message_id,
    name: args.name,
    part_index: args.part_index,
    call_part_index: toolCall.part_index,
    tool_call: toolCall.tool.data,
    tool_response: args.tool_response,
    tool_id: args.tool_id,
  });

  if (!context) return;

  pendingToolCalls.delete(args.tool_id);
  return toolHandlers[context.toolResponse.tool.name].response.handle?.(
    context
  );
}

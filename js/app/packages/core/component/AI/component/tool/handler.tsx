import { isErr } from '@core/util/maybeResult';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import { Dynamic } from 'solid-js/web';
import { bashCodeExecutionHandler } from './BashCodeExecution';
import { createDocumentHandler } from './CreateDocument';
import { getThreadHandler } from './GetThread';
import { listEntitiesHandler } from './ListEntities';
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
import {
  ToolErrorContext,
  type RenderContext,
  type ToolHandler,
  type ToolHandlerMap,
  type ToolRenderContext,
} from './ToolRenderer';
import { updateThreadLabelsHandler } from './UpdateThreadLabels';
import { webFetchHandler } from './WebFetch';
import { webSearchHandler } from './WebSearch';

const toolHandlers: ToolHandlerMap<RenderContext> = {
  GetEntityProperties: getEntityPropertiesHandler,
  ListEntities: listEntitiesHandler,
  bash_code_execution: bashCodeExecutionHandler,
  ContentSearch: contentSearchHandler,
  CreateDocument: createDocumentHandler,
  GetThread: getThreadHandler,
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

type ToolProps = {
  tool_id: string;
  json: unknown;
  name: string;
  response?: {
    json: unknown;
    name: string;
  };
  part_index: number;
  chat_id: string;
  message_id: string;
  isComplete: boolean;
  renderContext: RenderContext;
};

type TriggerToolArgs = Omit<
  ToolProps,
  'renderContext' | 'response' | 'isComplete'
> & {
  type: 'call' | 'response' | 'error';
};

export function RenderTool(props: ToolProps) {
  const maybeTool = deserializeToolCall({
    id: props.tool_id,
    json: props.json,
    name: props.name as ToolName,
  });
  if (isErr(maybeTool)) return null;

  const tool = maybeTool[1];
  const handler = toolHandlers[tool.name] as ToolHandler<
    ToolName,
    RenderContext
  >;
  const context: Omit<ToolRenderContext<ToolName>, 'response'> = {
    chat_id: props.chat_id,
    message_id: props.message_id,
    part_index: props.part_index,
    tool,
    isComplete: props.isComplete,
  };

  const response = () => {
    if (!props.response) return undefined;

    const maybeResponse = deserializeToolResponse({
      id: props.tool_id,
      json: props.response.json,
      name: props.response.name as ToolName,
    });

    if (isErr(maybeResponse)) return undefined;
    return maybeResponse[1];
  };

  return (
    <ToolErrorContext.Provider
      value={() => (props.isComplete && !response() ? 'failed' : undefined)}
    >
      <Dynamic
        component={handler.render}
        {...context}
        response={response()}
        renderContext={{
          isStreaming: props.renderContext.renderContext.isStreaming,
        }}
      />
    </ToolErrorContext.Provider>
  );
}

export async function triggerToolCall(args: TriggerToolArgs) {
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
  const handler = toolHandlers[tool.name] as ToolHandler<
    ToolName,
    RenderContext
  >;
  const handle = type === 'call' ? handler.handleCall : handler.handleResponse;
  if (!handle) return;

  const context = {
    chat_id,
    message_id,
    part_index,
    tool,
    isComplete: type !== 'call',
  };

  return handle(context as never);
}

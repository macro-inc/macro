import {
  deserializeToolCall,
  deserializeToolResponse,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import { Dynamic } from 'solid-js/web';
import { bashCodeExecutionHandler } from './BashCodeExecution';
import { createDocumentHandler } from './CreateDocument';
import { displayResultsHandler } from './DisplayResults';
import { getThreadHandler } from './GetThread';
import { listCallRecordsHandler } from './ListCallRecords';
import { listEntitiesHandler } from './ListEntities';
import { listLabelsHandler } from './ListLabels';
import { listTeamMembersHandler } from './ListTeamMembers';
import { loadToolsHandler } from './LoadTools';
import {
  listNotificationsHandler,
  markNotificationsDoneHandler,
  markNotificationsSeenHandler,
} from './Notifications';
import {
  getEntityPropertiesHandler,
  setEntityPropertyHandler,
} from './Properties';
import { readCallRecordHandler } from './ReadCallRecord';
import {
  readChannelMessageContextHandler,
  readChannelMessagesHandler,
  readChannelThreadHandler,
} from './ReadChannel';
import { readChatHandler } from './ReadChat';
import { readContentHandler } from './ReadContent';
import { readMetadataHandler } from './ReadMetadata';
import { readThreadHandler } from './ReadThread';
import { renameDocumentHandler } from './RenameDocument';
import { contentSearchHandler, nameSearchHandler } from './Search';
import { searchToolsHandler } from './SearchTools';
import { sendEmailHandler } from './SendEmail';
import { subagentHandler } from './Subagent';
import { textEditorCodeExecutionHandler } from './TextEditorCodeExecution';
import {
  type RenderContext,
  ToolErrorContext,
  type ToolHandler,
  type ToolHandlerMap,
  type ToolRenderContext,
} from './ToolRenderer';
import { updateThreadLabelsHandler } from './UpdateThreadLabels';
import { webFetchHandler } from './WebFetch';
import { webSearchHandler } from './WebSearch';

const toolHandlers: ToolHandlerMap<RenderContext> = {
  GetEntityProperties: getEntityPropertiesHandler,
  ListCallRecords: listCallRecordsHandler,
  ListEntities: listEntitiesHandler,
  ListLabels: listLabelsHandler,
  ListNotifications: listNotificationsHandler,
  ListTeamMembers: listTeamMembersHandler,
  LoadTools: loadToolsHandler,
  MarkNotificationsDone: markNotificationsDoneHandler,
  MarkNotificationsSeen: markNotificationsSeenHandler,
  BashCodeExecution: bashCodeExecutionHandler,
  DisplayResults: displayResultsHandler,
  ContentSearch: contentSearchHandler,
  CreateDocument: createDocumentHandler,
  GetThread: getThreadHandler,
  NameSearch: nameSearchHandler,
  ReadCallRecord: readCallRecordHandler,
  ReadChannelMessageContext: readChannelMessageContextHandler,
  ReadChannelMessages: readChannelMessagesHandler,
  ReadChannelThread: readChannelThreadHandler,
  ReadChat: readChatHandler,
  ReadThread: readThreadHandler,
  ReadContent: readContentHandler,
  ReadMetadata: readMetadataHandler,
  RenameDocument: renameDocumentHandler,
  SearchTools: searchToolsHandler,
  SendEmail: sendEmailHandler,
  SetEntityProperty: setEntityPropertyHandler,
  Subagent: subagentHandler,
  TextEditorCodeExecution: textEditorCodeExecutionHandler,
  UpdateThreadLabels: updateThreadLabelsHandler,
  WebFetch: webFetchHandler,
  WebSearch: webSearchHandler,
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
  if (maybeTool.isErr()) return null;

  const tool = maybeTool.value;
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

    if (maybeResponse.isErr()) return undefined;
    return maybeResponse.value;
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
          grouped: props.renderContext.renderContext.grouped,
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

  if (maybeTool.isErr()) return;

  const tool = maybeTool.value;
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

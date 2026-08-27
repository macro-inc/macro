import {
  deserializeToolCall,
  deserializeToolResponse,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import { Dynamic } from 'solid-js/web';
import { bashCodeExecutionHandler } from './BashCodeExecution';
import {
  configureBotHandler,
  createBotHandler,
  deleteBotHandler,
  getBotWebhooksHandler,
  issueBotCredentialHandler,
  listBotsHandler,
  manageBotChannelAccessHandler,
} from './Bots';
import {
  createCalendarEventHandler,
  deleteCalendarEventHandler,
  listCalendarEventsHandler,
  listCalendarsHandler,
  updateCalendarEventHandler,
} from './CalendarTools';
import {
  createChannelHandler,
  manageChannelParticipantsHandler,
  renameChannelHandler,
} from './ChannelMutations';
import { createDocumentHandler } from './CreateDocument';
import { createProjectHandler } from './CreateProject';
import { createTagHandler } from './CreateTag';
import { getCompanyHandler, listCompaniesHandler } from './Crm';
import { deleteTagHandler } from './DeleteTag';
import { displayResultsHandler } from './DisplayResults';
import { editDocumentHandler } from './EditDocument';
import { editTagHandler } from './EditTag';
import { getThreadHandler } from './GetThread';
import {
  createImportEntityHandler,
  deleteImportEntityHandler,
  importNotionPageHandler,
  listImportEntitiesHandler,
} from './ImportTools';
import { listEntitiesHandler } from './ListEntities';
import { listInboxesHandler } from './ListInboxes';
import { listLabelsHandler } from './ListLabels';
import { listTagsHandler } from './ListTags';
import { listTeamMembersHandler } from './ListTeamMembers';
import { loadToolsHandler } from './LoadTools';
import { moveToProjectHandler } from './MoveToProject';
import {
  listNotificationsHandler,
  markNotificationsDoneHandler,
  markNotificationsSeenHandler,
} from './Notifications';
import {
  bulkSetEntityPropertyOptionsHandler,
  getEntityPropertiesHandler,
  setEntityPropertyHandler,
} from './Properties';
import { readActivityHandler } from './ReadActivity';
import { readCallRecordHandler } from './ReadCallRecord';
import {
  readChannelMessageContextHandler,
  readChannelMessagesHandler,
  readChannelThreadHandler,
} from './ReadChannel';
import { readChatHandler } from './ReadChat';
import { readContentHandler } from './ReadContent';
import { readMetadataHandler } from './ReadMetadata';
import { readProjectHandler } from './ReadProject';
import { readThreadHandler } from './ReadThread';
import {
  createReminderHandler,
  deleteReminderHandler,
  listRemindersHandler,
  updateReminderHandler,
} from './Reminders';
import { renameDocumentHandler } from './RenameDocument';
import { contentSearchHandler, nameSearchHandler } from './Search';
import { listSkillsHandler, searchSkillsHandler } from './SearchSkills';
import { searchToolsHandler } from './SearchTools';
import { selfKnowledgeHandler } from './SelfKnowledge';
import { sendChannelMessageHandler } from './SendChannelMessage';
import { sendEmailHandler } from './SendEmail';
import { setSenderPolicyHandler } from './SetSenderPolicy';
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
  ConfigureBot: configureBotHandler,
  CreateChannel: createChannelHandler,
  CreateBot: createBotHandler,
  DeleteBot: deleteBotHandler,
  GetBotWebhooks: getBotWebhooksHandler,
  IssueBotCredential: issueBotCredentialHandler,
  ListBots: listBotsHandler,
  ManageBotChannelAccess: manageBotChannelAccessHandler,
  CreateCalendarEvent: createCalendarEventHandler,
  UpdateCalendarEvent: updateCalendarEventHandler,
  DeleteCalendarEvent: deleteCalendarEventHandler,
  ListCalendarEvents: listCalendarEventsHandler,
  ListCalendars: listCalendarsHandler,
  CreateImportEntity: createImportEntityHandler,
  DeleteImportEntity: deleteImportEntityHandler,
  ImportNotionPage: importNotionPageHandler,
  GetCompany: getCompanyHandler,
  GetEntityProperties: getEntityPropertiesHandler,
  ListCompanies: listCompaniesHandler,
  ListImportEntities: listImportEntitiesHandler,
  ListEntities: listEntitiesHandler,
  ListInboxes: listInboxesHandler,
  ListLabels: listLabelsHandler,
  ListSkills: listSkillsHandler,
  ManageChannelParticipants: manageChannelParticipantsHandler,
  ListNotifications: listNotificationsHandler,
  ListReminders: listRemindersHandler,
  ListTags: listTagsHandler,
  ListTeamMembers: listTeamMembersHandler,
  LoadTools: loadToolsHandler,
  MarkNotificationsDone: markNotificationsDoneHandler,
  MarkNotificationsSeen: markNotificationsSeenHandler,
  MoveToProject: moveToProjectHandler,
  BashCodeExecution: bashCodeExecutionHandler,
  DisplayResults: displayResultsHandler,
  ContentSearch: contentSearchHandler,
  CreateDocument: createDocumentHandler,
  CreateProject: createProjectHandler,
  CreateReminder: createReminderHandler,
  CreateTag: createTagHandler,
  DeleteReminder: deleteReminderHandler,
  DeleteTag: deleteTagHandler,
  EditDocument: editDocumentHandler,
  EditTag: editTagHandler,
  GetThread: getThreadHandler,
  NameSearch: nameSearchHandler,
  ReadActivity: readActivityHandler,
  ReadCallRecord: readCallRecordHandler,
  ReadChannelMessageContext: readChannelMessageContextHandler,
  ReadChannelMessages: readChannelMessagesHandler,
  ReadChannelThread: readChannelThreadHandler,
  ReadChat: readChatHandler,
  ReadThread: readThreadHandler,
  ReadContent: readContentHandler,
  ReadMetadata: readMetadataHandler,
  ReadProject: readProjectHandler,
  RenameChannel: renameChannelHandler,
  RenameDocument: renameDocumentHandler,
  SearchSkills: searchSkillsHandler,
  SearchTools: searchToolsHandler,
  SelfKnowledge: selfKnowledgeHandler,
  SendChannelMessage: sendChannelMessageHandler,
  SendEmail: sendEmailHandler,
  SetSenderPolicy: setSenderPolicyHandler,
  SetEntityProperty: setEntityPropertyHandler,
  BulkSetEntityPropertyOptions: bulkSetEntityPropertyOptionsHandler,
  Subagent: subagentHandler,
  TextEditorCodeExecution: textEditorCodeExecutionHandler,
  UpdateReminder: updateReminderHandler,
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

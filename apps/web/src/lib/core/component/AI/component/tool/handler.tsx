import {
  createCompanyHandler,
  createContactHandler,
  getCompanyHandler,
  listCompaniesHandler,
} from '@app/features/crm/crm-tool-renderers';
import { pipelineToolHandlers } from '@app/features/crm/pipeline-tool-renderers';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import {
  deserializeToolCall,
  deserializeToolResponse,
  type ToolName,
} from '@service-cognition/generated/tools/tool';
import { createMemo, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  createAgentSessionHandler,
  manageAgentSessionHandler,
  readAgentSessionSharingHandler,
  updateAgentSessionSharingHandler,
} from './AgentSessionActions';
import { configureAgentHandler, listAgentsHandler } from './Agents';
import { bashCodeExecutionHandler } from './BashCodeExecution';
import {
  createBookingLinkHandler,
  editBookingLinkHandler,
  listBookingLinksHandler,
} from './BookingLinks';
import {
  changeBookingHandler,
  getBookingInsightsHandler,
  getBookingRescheduleSlotsHandler,
  listBookingsHandler,
  readBookingSettingsHandler,
  updateBookingSettingsHandler,
} from './BookingManagement';
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
  addSharedCalendarEventHandler,
  createCalendarEventHandler,
  createConfirmedCalendarEventHandler,
  deleteCalendarEventHandler,
  listCalendarEventsHandler,
  listCalendarsHandler,
  readCalendarEventHandler,
  updateCalendarEventHandler,
} from './CalendarTools';
import {
  deleteCallRecordHandler,
  updateCallRecordHandler,
} from './CallRecordMutations';
import {
  applyCanvasEditsHandler,
  editCanvasHandler,
  readCanvasHandler,
  renderCanvasHandler,
} from './Canvas';
import {
  deleteChannelMessageHandler,
  editChannelMessageHandler,
  openDirectMessageHandler,
  reactToChannelMessageHandler,
} from './ChannelMessageMutations';
import {
  createChannelHandler,
  manageChannelParticipantsHandler,
  renameChannelHandler,
  shareWithChannelHandler,
} from './ChannelMutations';
import {
  describeCodeToolsHandler,
  executeCodeHandler,
  readCodeDocsHandler,
} from './CodeMode';
import {
  dispatchCodingAgentHandler,
  listCodingAgentsHandler,
} from './CodingAgents';
import { decideHandler, generateObjectHandler } from './Cognition';
import {
  commentHandler,
  commentOnTextHandler,
  deleteCommentHandler,
  editCommentHandler,
  readDiscussionHandler,
  resolveCommentHandler,
} from './Comments';
import { connectMcpServerHandler } from './ConnectMcpServer';
import { createDocumentHandler } from './CreateDocument';
import { createProjectHandler } from './CreateProject';
import { createSkillHandler } from './CreateSkill';
import { createTagHandler } from './CreateTag';
import {
  DatabaseToolPlaceholder,
  isToolShown,
  lazyDatabaseToolHandlers,
} from './DatabaseToolHandlers';
import { deleteTagHandler } from './DeleteTag';
import { readDesignHandler } from './Design';
import {
  readIllustratorDocumentHandler,
  readPhotoshopDocumentHandler,
} from './DesignDocument';
import { discoverConnectorsHandler } from './DiscoverConnectors';
import { displayResultsHandler } from './DisplayResults';
import { editDocumentHandler } from './EditDocument';
import { editTagHandler } from './EditTag';
import {
  duplicateItemHandler,
  moveToTrashHandler,
  renameItemHandler,
  updateSharingHandler,
} from './EntityLifecycle';
import { lazyFormsToolHandlers } from './FormsHandlers';
import { generateImageHandler } from './GenerateImage';
import { getThreadHandler } from './GetThread';
import {
  createImportEntityHandler,
  deleteImportEntityHandler,
  importFromJiraHandler,
  importFromLinearHandler,
  importFromNotionHandler,
  importNotionPageHandler,
  listImportEntitiesHandler,
} from './ImportTools';
import { initiativeToolHandlers } from './Initiatives';
import { LegacyGeneratedImage } from './LegacyGeneratedImage';
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
  muteNotificationsHandler,
} from './Notifications';
import {
  editPresentationHandler,
  readPresentationHandler,
} from './Presentation';
import {
  bulkSetEntityPropertyOptionsHandler,
  getEntityPropertiesHandler,
  setEntityPropertyHandler,
} from './Properties';
import { readActivityHandler } from './ReadActivity';
import { readAgentSessionHandler } from './ReadAgentSession';
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
import { readSkillHandler } from './ReadSkill';
import { readThreadHandler } from './ReadThread';
import { renameDocumentHandler } from './RenameDocument';
import {
  createRoutineHandler,
  deleteRoutineHandler,
  listRoutinesHandler,
  readRoutineHandler,
  runRoutineHandler,
  updateRoutineHandler,
} from './Routines';
import { contentSearchHandler, nameSearchHandler } from './Search';
import { listSkillsHandler, searchSkillsHandler } from './SearchSkills';
import { searchToolsHandler } from './SearchTools';
import { selfKnowledgeHandler } from './SelfKnowledge';
import { sendChannelMessageHandler } from './SendChannelMessage';
import { sendConfirmedEmailHandler } from './SendConfirmedEmail';
import { sendEmailHandler } from './SendEmail';
import { setFavoriteHandler } from './SetFavorite';
import { setSenderPolicyHandler } from './SetSenderPolicy';
import {
  calculateSpreadsheetHandler,
  editSpreadsheetHandler,
  readSpreadsheetHandler,
} from './Spreadsheet';
import { subagentHandler } from './Subagent';
import { getTeamAvailabilityHandler } from './TeamAvailability';
import { textEditorCodeExecutionHandler } from './TextEditorCodeExecution';
import {
  type RenderContext,
  type ToolEnding,
  ToolErrorContext,
  type ToolHandler,
  type ToolHandlerMap,
  type ToolRenderContext,
} from './ToolRenderer';
import { updateThreadLabelsHandler } from './UpdateThreadLabels';
import { uploadFileHandler } from './UploadFile';
import { webFetchHandler } from './WebFetch';
import { webSearchHandler } from './WebSearch';
import {
  editWordDocumentHandler,
  readWordDocumentHandler,
} from './WordDocument';

const toolHandlers: ToolHandlerMap<RenderContext> = {
  ...initiativeToolHandlers,
  ExecuteCode: executeCodeHandler,
  DescribeCodeTools: describeCodeToolsHandler,
  ReadCodeDocs: readCodeDocsHandler,
  DispatchCodingAgent: dispatchCodingAgentHandler,
  ListCodingAgents: listCodingAgentsHandler,
  ReadSpreadsheet: readSpreadsheetHandler,
  CalculateSpreadsheet: calculateSpreadsheetHandler,
  EditSpreadsheet: editSpreadsheetHandler,
  ReadPresentation: readPresentationHandler,
  EditPresentation: editPresentationHandler,
  ReadDesign: readDesignHandler,
  ReadPhotoshopDocument: readPhotoshopDocumentHandler,
  ReadIllustratorDocument: readIllustratorDocumentHandler,
  ReadWordDocument: readWordDocumentHandler,
  EditWordDocument: editWordDocumentHandler,
  ConfigureAgent: configureAgentHandler,
  ListAgents: listAgentsHandler,
  ConfigureBot: configureBotHandler,
  CreateChannel: createChannelHandler,
  EditChannelMessage: editChannelMessageHandler,
  DeleteChannelMessage: deleteChannelMessageHandler,
  ReactToChannelMessage: reactToChannelMessageHandler,
  OpenDirectMessage: openDirectMessageHandler,
  CreateBot: createBotHandler,
  DeleteBot: deleteBotHandler,
  GetBotWebhooks: getBotWebhooksHandler,
  IssueBotCredential: issueBotCredentialHandler,
  ListBots: listBotsHandler,
  ManageBotChannelAccess: manageBotChannelAccessHandler,
  ...lazyFormsToolHandlers,
  ReadBookingSettings: readBookingSettingsHandler,
  UpdateBookingSettings: updateBookingSettingsHandler,
  ListBookings: listBookingsHandler,
  GetBookingInsights: getBookingInsightsHandler,
  GetBookingRescheduleSlots: getBookingRescheduleSlotsHandler,
  ChangeBooking: changeBookingHandler,
  ListBookingLinks: listBookingLinksHandler,
  CreateBookingLink: createBookingLinkHandler,
  EditBookingLink: editBookingLinkHandler,
  CreateCalendarEvent: createCalendarEventHandler,
  CreateConfirmedCalendarEvent: createConfirmedCalendarEventHandler,
  UpdateCalendarEvent: updateCalendarEventHandler,
  DeleteCalendarEvent: deleteCalendarEventHandler,
  AddSharedCalendarEvent: addSharedCalendarEventHandler,
  ListCalendarEvents: listCalendarEventsHandler,
  ListCalendars: listCalendarsHandler,
  ReadCalendarEvent: readCalendarEventHandler,
  GetTeamAvailability: getTeamAvailabilityHandler,
  CreateImportEntity: createImportEntityHandler,
  DeleteImportEntity: deleteImportEntityHandler,
  ImportFromNotion: importFromNotionHandler,
  ImportFromLinear: importFromLinearHandler,
  ImportFromJira: importFromJiraHandler,
  ImportNotionPage: importNotionPageHandler,
  ConnectMcpServer: connectMcpServerHandler,
  GetCompany: getCompanyHandler,
  CreateCompany: createCompanyHandler,
  CreateContact: createContactHandler,
  GetEntityProperties: getEntityPropertiesHandler,
  ListCompanies: listCompaniesHandler,
  ...pipelineToolHandlers,
  ListImportEntities: listImportEntitiesHandler,
  ...lazyDatabaseToolHandlers,
  ListEntities: listEntitiesHandler,
  ListInboxes: listInboxesHandler,
  ListLabels: listLabelsHandler,
  ListSkills: listSkillsHandler,
  ManageChannelParticipants: manageChannelParticipantsHandler,
  ListNotifications: listNotificationsHandler,
  CreateRoutine: createRoutineHandler,
  ListRoutines: listRoutinesHandler,
  ReadRoutine: readRoutineHandler,
  UpdateRoutine: updateRoutineHandler,
  RunRoutine: runRoutineHandler,
  DeleteRoutine: deleteRoutineHandler,
  ListTags: listTagsHandler,
  ListTeamMembers: listTeamMembersHandler,
  LoadTools: loadToolsHandler,
  MarkNotificationsDone: markNotificationsDoneHandler,
  MarkNotificationsSeen: markNotificationsSeenHandler,
  MuteNotifications: muteNotificationsHandler,
  MoveToProject: moveToProjectHandler,
  MoveToTrash: moveToTrashHandler,
  DuplicateItem: duplicateItemHandler,
  RenameItem: renameItemHandler,
  UpdateSharing: updateSharingHandler,
  BashCodeExecution: bashCodeExecutionHandler,
  DisplayResults: displayResultsHandler,
  DiscoverConnectors: discoverConnectorsHandler,
  ContentSearch: contentSearchHandler,
  CreateDocument: createDocumentHandler,
  CreateSkill: createSkillHandler,
  UploadFile: uploadFileHandler,
  GenerateImage: generateImageHandler,
  GenerateObject: generateObjectHandler,
  Decide: decideHandler,
  CreateProject: createProjectHandler,
  CreateTag: createTagHandler,
  DeleteTag: deleteTagHandler,
  EditDocument: editDocumentHandler,
  ReadCanvas: readCanvasHandler,
  RenderCanvas: renderCanvasHandler,
  EditCanvas: editCanvasHandler,
  ApplyCanvasEdits: applyCanvasEditsHandler,
  EditTag: editTagHandler,
  GetThread: getThreadHandler,
  NameSearch: nameSearchHandler,
  ReadActivity: readActivityHandler,
  ReadCallRecord: readCallRecordHandler,
  UpdateCallRecord: updateCallRecordHandler,
  DeleteCallRecord: deleteCallRecordHandler,
  ReadChannelMessageContext: readChannelMessageContextHandler,
  ReadChannelMessages: readChannelMessagesHandler,
  ReadChannelThread: readChannelThreadHandler,
  ReadChat: readChatHandler,
  ReadAgentSession: readAgentSessionHandler,
  CreateAgentSession: createAgentSessionHandler,
  ManageAgentSession: manageAgentSessionHandler,
  ReadAgentSessionSharing: readAgentSessionSharingHandler,
  UpdateAgentSessionSharing: updateAgentSessionSharingHandler,
  ReadThread: readThreadHandler,
  ReadContent: readContentHandler,
  ReadMetadata: readMetadataHandler,
  ReadProject: readProjectHandler,
  ReadSkill: readSkillHandler,
  RenameChannel: renameChannelHandler,
  RenameDocument: renameDocumentHandler,
  ReadDiscussion: readDiscussionHandler,
  Comment: commentHandler,
  CommentOnText: commentOnTextHandler,
  ResolveComment: resolveCommentHandler,
  EditComment: editCommentHandler,
  DeleteComment: deleteCommentHandler,
  SearchSkills: searchSkillsHandler,
  SearchTools: searchToolsHandler,
  SelfKnowledge: selfKnowledgeHandler,
  SendChannelMessage: sendChannelMessageHandler,
  ShareWithChannel: shareWithChannelHandler,
  SendConfirmedEmail: sendConfirmedEmailHandler,
  SendEmail: sendEmailHandler,
  SetSenderPolicy: setSenderPolicyHandler,
  SetFavorite: setFavoriteHandler,
  SetEntityProperty: setEntityPropertyHandler,
  BulkSetEntityPropertyOptions: bulkSetEntityPropertyOptionsHandler,
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
  /** The tool's reason for a call that failed. */
  error?: string;
  /** The turn ended before the call returned. */
  stopped?: boolean;
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

/** Schema support alone does not guarantee that this surface has a renderer. */
export function hasToolRenderer(name: string): boolean {
  return Object.hasOwn(toolHandlers, name);
}

export function RenderTool(props: ToolProps) {
  const databasesEnabled = useFeatureFlag(enableDatabases);
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

  /*
   Every streamed character rebuilds the message parts (and the response map),
   giving `props.response` a fresh object identity even though its `json`
   payload is reference-stable once the tool result has arrived. Compare by
   field identity so the expensive parse below only re-runs when the response
   actually changes.
  */
  const responseInput = createMemo(
    () =>
      props.response
        ? {
            id: props.tool_id,
            json: props.response.json,
            name: props.response.name,
          }
        : undefined,
    undefined,
    {
      equals: (a, b) =>
        a?.id === b?.id && a?.json === b?.json && a?.name === b?.name,
    }
  );

  /*
   Deserializing runs a full zod parse of the tool payload. Unmemoized, it
   re-ran per read site in every tool component on each streamed character,
   which made streaming crawl on messages with completed tool calls.
  */
  const response = createMemo(() => {
    const input = responseInput();
    if (!input) return undefined;

    const maybeResponse = deserializeToolResponse({
      id: input.id,
      json: input.json,
      name: input.name as ToolName,
    });

    if (maybeResponse.isErr()) return undefined;
    return maybeResponse.value;
  });

  return (
    <LegacyGeneratedImage
      name={props.name}
      response={
        props.response?.name === props.name ? props.response.json : undefined
      }
    >
      <ToolErrorContext.Provider
        value={(): ToolEnding | undefined => {
          if (props.error !== undefined) {
            return { kind: 'failed', reason: props.error };
          }
          if (props.stopped) return { kind: 'stopped' };
          if (props.isComplete && !response()) return { kind: 'failed' };
          return undefined;
        }}
      >
        <Show
          when={isToolShown(tool.name, databasesEnabled().enabled)}
          fallback={<DatabaseToolPlaceholder />}
        >
          <Dynamic
            component={handler.render}
            {...context}
            response={response()}
            renderContext={{
              isStreaming: props.renderContext.renderContext.isStreaming,
              grouped: props.renderContext.renderContext.grouped,
              running:
                !props.isComplete &&
                props.renderContext.renderContext.isStreaming,
              followedBy: props.renderContext.renderContext.followedBy,
            }}
          />
        </Show>
      </ToolErrorContext.Provider>
    </LegacyGeneratedImage>
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

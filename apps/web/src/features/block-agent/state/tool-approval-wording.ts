/**
 * What a held tool call wants to do, in words a person reads at a glance:
 * "read your email", not `ListInboxes {"limit": 5}`. `whose` is the
 * possessive of the owner whose access the call spends ("your", "Alice's").
 */

import type { ToolName as MacroToolName } from '@service-cognition/generated/tools/tool';

type Wording = (whose: string) => string;

/**
 * Every Macro tool, so a new one does not type-check until it is worded.
 * `null` for the tools that use nobody's access and so are never held.
 */
const MACRO_TOOLS: Record<MacroToolName, Wording | null> = {
  BashCodeExecution: (whose) => `run code with ${whose} access`,
  BulkSetEntityPropertyOptions: (whose) =>
    `change property options in ${whose} workspace`,
  CalculateSpreadsheet: (whose) => `calculate in ${whose} spreadsheets`,
  CommentOnDocument: (whose) => `comment on ${whose} documents`,
  ConfigureAgent: (whose) => `change ${whose} agents`,
  ConfigureBot: (whose) => `change ${whose} bots`,
  ContentSearch: (whose) => `search ${whose} workspace`,
  CreateBookingLink: (whose) => `create a booking link for ${whose} calendar`,
  CreateBot: (whose) => `create a bot in ${whose} workspace`,
  CreateCalendarEvent: (whose) => `add an event to ${whose} calendar`,
  CreateChannel: (whose) => `create a channel from ${whose} account`,
  CreateConfirmedCalendarEvent: (whose) => `add an event to ${whose} calendar`,
  CreateDocument: (whose) => `create a document in ${whose} workspace`,
  CreateImportEntity: (whose) => `import into ${whose} workspace`,
  CreateInitiative: (whose) => `create an initiative in ${whose} workspace`,
  CreateProject: (whose) => `create a project in ${whose} workspace`,
  CreateRoutine: (whose) => `create a routine for ${whose} account`,
  CreateTag: (whose) => `create a tag in ${whose} workspace`,
  DeleteBot: (whose) => `delete ${whose} bots`,
  DeleteCalendarEvent: (whose) => `delete an event from ${whose} calendar`,
  DeleteDatabaseView: (whose) => `delete a view from ${whose} databases`,
  DeleteImportEntity: (whose) => `delete an import from ${whose} workspace`,
  DeleteInitiative: (whose) => `delete ${whose} initiatives`,
  DeleteTag: (whose) => `delete tags in ${whose} workspace`,
  DescribeDatabase: (whose) => `read ${whose} databases`,
  DisplayResults: (whose) => `show results from ${whose} workspace`,
  DispatchCodingAgent: (whose) => `start a coding agent with ${whose} access`,
  EditBookingLink: (whose) => `edit ${whose} booking links`,
  EditDocument: (whose) => `edit ${whose} documents`,
  EditPresentation: (whose) => `edit ${whose} presentations`,
  EditSpreadsheet: (whose) => `edit ${whose} spreadsheets`,
  EditTag: (whose) => `edit tags in ${whose} workspace`,
  EditWordDocument: (whose) => `edit ${whose} documents`,
  GenerateImage: (whose) => `generate an image with ${whose} account`,
  GetBotWebhooks: (whose) => `read ${whose} bot webhooks`,
  GetCompany: (whose) => `look up companies in ${whose} workspace`,
  GetEntityProperties: (whose) => `read properties in ${whose} workspace`,
  GetThread: (whose) => `read ${whose} email`,
  ImportNotionPage: (whose) => `import a Notion page into ${whose} workspace`,
  IssueBotCredential: (whose) => `issue credentials for ${whose} bots`,
  ListAgents: (whose) => `list ${whose} agents`,
  ListBookingLinks: (whose) => `read ${whose} booking links`,
  ListBots: (whose) => `list ${whose} bots`,
  ListCalendarEvents: (whose) => `read ${whose} calendar`,
  ListCalendars: (whose) => `read ${whose} calendar`,
  ListCodingAgents: (whose) => `list ${whose} coding agents`,
  ListCompanies: (whose) => `look up companies in ${whose} workspace`,
  ListDatabases: (whose) => `list ${whose} databases`,
  ListEntities: (whose) => `list ${whose} files and tasks`,
  ListImportEntities: (whose) => `list imports in ${whose} workspace`,
  ListInboxes: (whose) => `look through ${whose} email`,
  ListInitiatives: (whose) => `list ${whose} initiatives`,
  ListLabels: (whose) => `read ${whose} email labels`,
  ListNotifications: (whose) => `read ${whose} notifications`,
  ListRoutines: (whose) => `list ${whose} routines`,
  ListSkills: (whose) => `list ${whose} skills`,
  ListTags: (whose) => `list tags in ${whose} workspace`,
  ListTeamMembers: (whose) => `look up ${whose} teammates`,
  LoadTools: null,
  ManageBotChannelAccess: (whose) =>
    `change which channels ${whose} bots can use`,
  ManageChannelParticipants: (whose) => `change who is in ${whose} channels`,
  MarkNotificationsDone: (whose) => `mark ${whose} notifications done`,
  MarkNotificationsSeen: (whose) => `mark ${whose} notifications seen`,
  MoveToProject: (whose) => `reorganize ${whose} projects`,
  NameSearch: (whose) => `search ${whose} workspace`,
  QueryDatabase: (whose) => `query ${whose} databases`,
  ReadActivity: (whose) => `read ${whose} recent activity`,
  ReadCallRecord: (whose) => `read ${whose} call recordings`,
  ReadChannelMessageContext: (whose) => `read ${whose} channel messages`,
  ReadChannelMessages: (whose) => `read ${whose} channel messages`,
  ReadChannelThread: (whose) => `read ${whose} channel messages`,
  ReadChat: (whose) => `read ${whose} chats`,
  ReadContent: (whose) => `read ${whose} documents`,
  ReadDesign: (whose) => `read ${whose} designs`,
  ReadIllustratorDocument: (whose) => `read ${whose} Illustrator files`,
  ReadInitiative: (whose) => `read ${whose} initiatives`,
  ReadInitiativeActivity: (whose) => `read activity on ${whose} initiatives`,
  ReadMetadata: (whose) => `look up details in ${whose} workspace`,
  ReadPhotoshopDocument: (whose) => `read ${whose} Photoshop files`,
  ReadPresentation: (whose) => `read ${whose} presentations`,
  ReadProject: (whose) => `read ${whose} projects`,
  ReadRoutine: (whose) => `read ${whose} routines`,
  ReadSkill: (whose) => `read ${whose} skills`,
  ReadSpreadsheet: (whose) => `read ${whose} spreadsheets`,
  ReadThread: (whose) => `read ${whose} email`,
  ReadWordDocument: (whose) => `read ${whose} documents`,
  RenameChannel: (whose) => `rename ${whose} channels`,
  RenameDocument: (whose) => `rename ${whose} documents`,
  ResolveDocumentComment: (whose) => `resolve comments on ${whose} documents`,
  SaveDatabaseQuery: (whose) => `save a query in ${whose} databases`,
  SaveDatabaseView: (whose) => `save a view in ${whose} databases`,
  SearchSkills: (whose) => `search ${whose} skills`,
  SearchTools: null,
  SelfKnowledge: null,
  SendChannelMessage: (whose) => `post a message from ${whose} account`,
  SendConfirmedEmail: (whose) => `send email from ${whose} account`,
  SendEmail: (whose) => `send email from ${whose} account`,
  SetEntityProperty: (whose) => `set properties in ${whose} workspace`,
  SetSenderPolicy: (whose) => `change ${whose} email sender rules`,
  Subagent: (whose) => `start a helper agent with ${whose} access`,
  TextEditorCodeExecution: (whose) => `edit files with ${whose} access`,
  UpdateCalendarEvent: (whose) => `change an event on ${whose} calendar`,
  UpdateInitiative: (whose) => `change ${whose} initiatives`,
  UpdateInitiativeSharing: (whose) => `change who can see ${whose} initiatives`,
  UpdateRoutine: (whose) => `change ${whose} routines`,
  UpdateThreadLabels: (whose) => `relabel ${whose} email`,
  UploadFile: (whose) => `upload a file to ${whose} workspace`,
  WebFetch: null,
  WebSearch: null,
};

function isMacroTool(tool: string): tool is MacroToolName {
  return Object.hasOwn(MACRO_TOOLS, tool);
}

/** `ListEntities` → `list entities`, `linear-create-issue` → `linear create issue`. */
function toolWords(tool: string): string {
  return tool
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The verb phrase for a held call, e.g. `read your email`. */
export function describeToolCall(
  server: { slug: string; name: string },
  tool: string,
  whose: string
): string {
  if (server.slug !== 'macro') {
    return `use ${whose} ${server.name} account (${toolWords(tool)})`;
  }
  // A tool newer than this build, or one never held, reads by its name.
  const wording = isMacroTool(tool) ? MACRO_TOOLS[tool] : null;
  return wording
    ? wording(whose)
    : `use ${whose} Macro workspace (${toolWords(tool)})`;
}

/**
 * What approving a call for good covers, as a verb phrase: the same tool on
 * Macro, whose one server reaches all of the owner's data, or the whole
 * connected app.
 */
export function describeStandingApproval(
  server: { slug: string; name: string },
  tool: string,
  whose: string
): string {
  return server.slug === 'macro'
    ? describeToolCall(server, tool, whose)
    : `use ${whose} ${server.name} account`;
}

/** `Alice Seed` → `Alice Seed's`; a name ending in s takes a bare apostrophe. */
export function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

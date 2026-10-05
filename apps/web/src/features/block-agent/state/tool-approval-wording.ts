/**
 * What a held tool call wants to do, in words a person reads at a glance:
 * "read your email", not `ListInboxes {"limit": 5}`. `whose` is the
 * possessive of the owner whose access the call spends ("your", "Alice's").
 */

type Wording = (whose: string) => string;

const MACRO_TOOLS: Record<string, Wording> = {
  ListInboxes: (whose) => `look through ${whose} email`,
  GetThread: (whose) => `read ${whose} email`,
  ReadThread: (whose) => `read ${whose} email`,
  UpdateThreadLabels: (whose) => `relabel ${whose} email`,
  SetSenderPolicy: (whose) => `change ${whose} email sender rules`,
  SendEmail: (whose) => `send email from ${whose} account`,
  SendConfirmedEmail: (whose) => `send email from ${whose} account`,
  ListCalendarEvents: (whose) => `read ${whose} calendar`,
  ListCalendars: (whose) => `read ${whose} calendar`,
  CreateCalendarEvent: (whose) => `add an event to ${whose} calendar`,
  UpdateCalendarEvent: (whose) => `change an event on ${whose} calendar`,
  DeleteCalendarEvent: (whose) => `delete an event from ${whose} calendar`,
  ReadContent: (whose) => `read ${whose} documents`,
  ReadDocument: (whose) => `read ${whose} documents`,
  ReadWordDocument: (whose) => `read ${whose} documents`,
  ReadPresentation: (whose) => `read ${whose} presentations`,
  ReadSpreadsheet: (whose) => `read ${whose} spreadsheets`,
  ReadMetadata: (whose) => `look up details in ${whose} workspace`,
  ContentSearch: (whose) => `search ${whose} workspace`,
  NameSearch: (whose) => `search ${whose} workspace`,
  ListEntities: (whose) => `list ${whose} files and tasks`,
  ReadChat: (whose) => `read ${whose} chats`,
  ReadChannelMessages: (whose) => `read ${whose} channel messages`,
  ReadChannelThread: (whose) => `read ${whose} channel messages`,
  ReadChannelMessageContext: (whose) => `read ${whose} channel messages`,
  SendChannelMessage: (whose) => `post a message from ${whose} account`,
  ReadCallRecord: (whose) => `read ${whose} call recordings`,
  ReadActivity: (whose) => `read ${whose} recent activity`,
  ListNotifications: (whose) => `read ${whose} notifications`,
  ListReminders: (whose) => `read ${whose} reminders`,
  ListTeamMembers: (whose) => `look up ${whose} teammates`,
  ReadProject: (whose) => `read ${whose} projects`,
  CreateDocument: (whose) => `create a document in ${whose} workspace`,
  EditDocument: (whose) => `edit ${whose} documents`,
  EditWordDocument: (whose) => `edit ${whose} documents`,
  RenameDocument: (whose) => `rename ${whose} documents`,
  EditSpreadsheet: (whose) => `edit ${whose} spreadsheets`,
  EditPresentation: (whose) => `edit ${whose} presentations`,
  CommentOnDocument: (whose) => `comment on ${whose} documents`,
  ResolveDocumentComment: (whose) => `resolve comments on ${whose} documents`,
  UploadFile: (whose) => `upload a file to ${whose} workspace`,
  CreateReminder: (whose) => `add a reminder for ${whose} account`,
  CreateProject: (whose) => `create a project in ${whose} workspace`,
  MoveToProject: (whose) => `reorganize ${whose} projects`,
};

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
  if (server.slug === 'macro') {
    const wording = MACRO_TOOLS[tool];
    return wording
      ? wording(whose)
      : `use ${whose} Macro workspace (${toolWords(tool)})`;
  }
  return `use ${whose} ${server.name} account (${toolWords(tool)})`;
}

/** `Alice Seed` → `Alice Seed's`; a name ending in s takes a bare apostrophe. */
export function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

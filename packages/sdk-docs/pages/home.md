# Build with Macro

The Macro SDK lets you work with documents, email, conversations, tasks, and
structured data from JavaScript or TypeScript. Use it to build integrations,
automate work, or give an agent access to your workspace.

Start with an entity such as a document or email thread. Its methods let you
read content, follow related entities, and make changes. The same API works
across scripts and applications; Macro checks permissions on every request.

## Quick start

Install the SDK with `npm install @macro-inc/sdk`. Create an API key in Macro's
**Settings → API Keys**, then set `MACRO_API_KEY` in your script's environment.

```ts
import { Macro } from '@macro-inc/sdk';

const macro = new Macro({});

// Find a document and read its text. Stop after the first match.
for await (const document of macro.documents.search('weekly update')) {
  console.log(await document.name());
  console.log(await document.content());
  break;
}
```

See {@link src/config!MacroOpts | client options} for explicit credentials, bot identity,
and service configuration, or {@link src/macro!Macro | the Macro client} for every entry point.

## Find the right entity

An **entity** is a thing in Macro, such as a document, person, or project.
The SDK groups related operations into namespaces on `macro`. Each link below
opens the methods and exact request and response types for that namespace.

### Content and work

| Entry point | What it represents |
| --- | --- |
| {@link src/entities/documents/namespace!DocumentNamespace | macro.documents} | Documents and files in your workspace, with content, comments, sharing, and history. |
| {@link src/entities/tasks/namespace!TaskNamespace | macro.tasks} | Work to track and complete, with assignees, due dates, and status. |
| {@link src/entities/projects/namespace!ProjectNamespace | macro.projects} | Collections that organize documents and other workspace items. |
| {@link src/entities/workspace/namespace!WorkspaceNamespace | macro.workspace} | A view across workspace activity, filtered by entity type, time, properties, or inbox state. |
| {@link src/entities/databases/namespace!DatabaseNamespace | macro.databases} | Structured information in tables, with typed handles, SQL queries, atomic version-guarded writes, and views. |
| {@link src/entities/forms/namespace!FormNamespace | macro.forms} | Questions that collect responses into a database without giving respondents access to its other rows. |
| {@link src/entities/properties/namespace!PropertiesNamespace | macro.properties} | Custom fields and their options, used to describe and filter entities. |
| {@link src/entities/foreign/namespace!ForeignEntityNamespace | macro.foreignEntities} | References to items in external systems that are linked into Macro. |

### Communication

| Entry point | What it represents |
| --- | --- |
| {@link src/entities/email/namespace!EmailNamespace | macro.email} | Connected mailboxes, threads, messages, drafts, attachments, and labels. |
| {@link src/entities/channels/namespace!ChannelNamespace | macro.channels} | Shared conversations with messages, replies, threads, and posts. |
| {@link src/entities/chats/namespace!ChatNamespace | macro.chats} | AI chat conversations and their messages. |
| {@link src/entities/calendar/namespace!CalendarNamespace | macro.calendar} | Connected calendars and events, including timing, attendees, and invitations. |
| {@link src/entities/calls/namespace!CallRecordNamespace | macro.calls} | Recorded calls and the transcripts associated with them. |
| {@link src/entities/notifications/namespace!NotificationNamespace | macro.notifications} | Activity notices for the current user, with seen/done state and delivery preferences. |

### People and organization

| Entry point | What it represents |
| --- | --- |
| {@link src/entities/users/namespace!UserNamespace | macro.users} | People in Macro and their profiles, including the authenticated user. |
| {@link src/entities/teams/namespace!TeamNamespace | macro.teams} | Teams and their memberships. |
| {@link src/entities/crm/namespace!CrmNamespace | macro.crm} | Company and contact records, with notes and relationships. |
| {@link src/entities/favorites/namespace!FavoritesNamespace | macro.favorites} | Entities the current user has saved as favorites. |
| {@link src/entities/pins/namespace!PinsNamespace | macro.pins} | Items pinned to fixed positions in the user's home view. |

### AI and integrations

| Entry point | What it represents |
| --- | --- |
| {@link src/entities/agent-sessions/namespace!AgentSessionNamespace | macro.agentSessions} | Agent conversations with their configuration, messages, queued actions, and execution state. |
| {@link src/entities/bots/namespace!BotsNamespace | macro.bots} | Bot identities and their configuration. |
| {@link src/entities/ai/namespace!AiNamespace | macro.ai} | AI operations on content you supply: structured generation and yes/no classification with Jev. |
| {@link src/events/receiver!MacroEvents | macro.events} | Live entity events your application can subscribe to through a stream or webhook receiver. |
| {@link src/entities/webhooks/namespace!WebhooksNamespace | macro.webhooks} | Persistent subscriptions that deliver events to your application's URL. |

### Automation and resource management

Routines, configurable agents and their hosts use typed handles:
{@link src/entities/routines/namespace!RoutineNamespace | macro.routines},
{@link src/entities/agents/namespace!AgentNamespace | macro.agents} and
{@link src/entities/harnesses/namespace!HarnessNamespace | macro.harnesses}.
Routine triggers can reference entities, and executions return transcript handles.
Agent conversations and tool approvals retain channel/session scope.

Use {@link src/entities/initiatives/namespace!InitiativeNamespace | macro.initiatives}
for task initiatives, {@link src/entities/meetings/namespace!MeetingNamespace | macro.meetings}
for schedules and invitations, and
{@link src/entities/api-keys/namespace!ApiKeyNamespace | macro.apiKeys} for credentials.
API key creation returns the secret separately; handles serialize metadata only.

CRM pipelines live at `macro.crm.pipelines`; tables, columns and rows retain their
pipeline authorization boundary. Email supports editable drafts, upload and
forwarded attachment handles, scheduled sends, importance filters and follow-ups.
Draft writes retain the selected inbox, and plain HTML is encoded for the wire.

Shareable resources expose `.access` for revision-aware requests and direct grants.
Message-bearing resources expose `messageThreadById` and `timelinePage`; timeline
messages are seeded handles. Calendar occurrence iteration seeds event handles and
preserves its viewport while paging. Document versions and PDF annotations are
scoped to their parent document.

GitHub pull request snapshots and diffs use `macro.githubPullRequests`. Cross-resource
mentions use `macro.entityMentions`, with typed source and target references.
`macro.unfurls` reads URL metadata; `chat.send` returns a generation with a response
message handle and explicit cancellation. `macro.ai.usage` reads usage summaries.

## How to use entity handles

`macro.documents.byId(id)` creates a handle to an existing document. Creating
the handle does not fetch its data. Read fields with `await document.name()`
or call methods such as `await document.content()`. Related objects are handles
too: `await document.owner()` returns a user you can inspect.

List and search methods that return async iterators fetch pages as you iterate.
Use `for await` to process results and `break` when you have enough. Independent
reads can run together with `Promise.all`; await dependencies before using them.

```ts
const document = macro.documents.byId(documentId);
const [name, content] = await Promise.all([
  document.name(),
  document.content(),
]);
```

## Read the API reference

Follow an entity link above to see its methods, examples, and linked types.
The reference is generated from the SDK's declarations and comments using
TypeDoc, including the API request and response types used by those methods.
For shared behavior, see {@link src/entities/entity!MacroEntity | entity handles},
{@link src/entities/search!SearchOpts | search options}, and {@link src/mentions!msg | rich messages and mentions}.

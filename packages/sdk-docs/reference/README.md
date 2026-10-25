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

See [client options](src/config/interfaces/MacroOpts.md) for explicit credentials, bot identity,
and service configuration, or [the Macro client](src/macro/classes/Macro.md) for every entry point.

## Find the right entity

An **entity** is a thing in Macro, such as a document, person, or project.
The SDK groups related operations into namespaces on `macro`. Each link below
opens the methods and exact request and response types for that namespace.

### Content and work

| Entry point | What it represents |
| --- | --- |
| [macro.documents](src/entities/documents/namespace/classes/DocumentNamespace.md) | Documents and files in your workspace, with content, comments, sharing, and history. |
| [macro.tasks](src/entities/tasks/namespace/classes/TaskNamespace.md) | Work to track and complete, with assignees, due dates, and status. |
| [macro.projects](src/entities/projects/namespace/classes/ProjectNamespace.md) | Collections that organize documents and other workspace items. |
| [macro.workspace](src/entities/workspace/namespace/classes/WorkspaceNamespace.md) | A view across workspace activity, filtered by entity type, time, properties, or inbox state. |
| [macro.databases](src/entities/databases/namespace/classes/DatabaseNamespace.md) | Structured information in tables, with typed handles, SQL queries, atomic version-guarded writes, and views. |
| [macro.forms](src/entities/forms/namespace/classes/FormNamespace.md) | Questions that collect responses into a database without giving respondents access to its other rows. |
| [macro.properties](src/entities/properties/namespace/classes/PropertiesNamespace.md) | Custom fields and their options, used to describe and filter entities. |
| [macro.foreignEntities](src/entities/foreign/namespace/classes/ForeignEntityNamespace.md) | References to items in external systems that are linked into Macro. |

### Communication

| Entry point | What it represents |
| --- | --- |
| [macro.email](src/entities/email/namespace/classes/EmailNamespace.md) | Connected mailboxes, threads, messages, drafts, attachments, and labels. |
| [macro.channels](src/entities/channels/namespace/classes/ChannelNamespace.md) | Shared conversations with messages, replies, threads, and posts. |
| [macro.chats](src/entities/chats/namespace/classes/ChatNamespace.md) | AI chat conversations and their messages. |
| [macro.calendar](src/entities/calendar/namespace/classes/CalendarNamespace.md) | Connected calendars and events, including timing, attendees, and invitations. |
| [macro.calls](src/entities/calls/namespace/classes/CallRecordNamespace.md) | Recorded calls and the transcripts associated with them. |
| [macro.notifications](src/entities/notifications/namespace/classes/NotificationNamespace.md) | Activity notices for the current user, with seen/done state and delivery preferences. |

### People and organization

| Entry point | What it represents |
| --- | --- |
| [macro.users](src/entities/users/namespace/classes/UserNamespace.md) | People in Macro and their profiles, including the authenticated user. |
| [macro.teams](src/entities/teams/namespace/classes/TeamNamespace.md) | Teams and their memberships. |
| [macro.crm](src/entities/crm/namespace/classes/CrmNamespace.md) | Company and contact records, with notes and relationships. |
| [macro.favorites](src/entities/favorites/namespace/classes/FavoritesNamespace.md) | Entities the current user has saved as favorites. |
| [macro.pins](src/entities/pins/namespace/classes/PinsNamespace.md) | Items pinned to fixed positions in the user's home view. |

### AI and integrations

| Entry point | What it represents |
| --- | --- |
| [macro.agentSessions](src/entities/agent-sessions/namespace/classes/AgentSessionNamespace.md) | Agent conversations with their configuration, messages, queued actions, and execution state. |
| [macro.bots](src/entities/bots/namespace/classes/BotsNamespace.md) | Bot identities and their configuration. |
| [macro.ai](src/entities/ai/namespace/classes/AiNamespace.md) | AI operations on content you supply: structured generation and yes/no classification with Jev. |
| [macro.events](src/events/receiver/classes/MacroEvents.md) | Live entity events your application can subscribe to through a stream or webhook receiver. |
| [macro.webhooks](src/entities/webhooks/namespace/classes/WebhooksNamespace.md) | Persistent subscriptions that deliver events to your application's URL. |

### Automation and resource management

Routines, configurable agents and their hosts use typed handles:
[macro.routines](src/entities/routines/namespace/classes/RoutineNamespace.md),
[macro.agents](src/entities/agents/namespace/classes/AgentNamespace.md) and
[macro.harnesses](src/entities/harnesses/namespace/classes/HarnessNamespace.md).
Routine triggers can reference entities, and executions return transcript handles.
Agent conversations and tool approvals retain channel/session scope.

Use [macro.initiatives](src/entities/initiatives/namespace/classes/InitiativeNamespace.md)
for task initiatives, [macro.meetings](src/entities/meetings/namespace/classes/MeetingNamespace.md)
for schedules and invitations, and
[macro.apiKeys](src/entities/api-keys/namespace/classes/ApiKeyNamespace.md) for credentials.
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
For shared behavior, see [entity handles](src/entities/entity/classes/MacroEntity.md),
[search options](src/entities/search/interfaces/SearchOpts.md), and [rich messages and mentions](src/mentions/functions/msg.md).

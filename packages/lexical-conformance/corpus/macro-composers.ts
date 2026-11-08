// Actual source composer entry points, including every typed trigger/event renderer.
import { mock, setSystemTime } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
setSystemTime(new Date('2026-11-07T12:00:00Z'));
mock.module(
  createRequire(root + 'packages/lexical-core/nodes/AwaitNode.ts').resolve(
    'nanoid'
  ),
  () => ({ nanoid: (size = 21) => 'u'.repeat(size) })
);
await import(root + 'services/lexical-service/src/polyfills/prism.ts');
const context = await import(
  root + 'packages/lexical-core/utils/agent-context.ts'
);
const replies = await import(
  root + 'packages/lexical-core/utils/agent-chat-reply.ts'
);
const announcement = await import(
  root + 'packages/lexical-core/utils/agent-announcement.ts'
);
const connection = await import(
  root + 'packages/lexical-core/utils/agent-connection-prompt.ts'
);
const image = await import(
  root + 'packages/lexical-core/utils/image-markdown.ts'
);
if (process.argv.includes('--native')) {
  const inputs = await Bun.stdin.json();
  await Bun.write(
    Bun.stdout,
    JSON.stringify(
      inputs.map((input) => context.composeAgentContextPrompt(input))
    )
  );
  process.exit(0);
}
const id = '00000000-0000-4000-8000-000000000001';
const time = '2026-11-07T12:00:00.123456Z';
const person = { id: 'person-one', name: 'Reader', email: 'user@example.com' };
const message = {
  id,
  author: person,
  content: '**message** <&>',
  posted_at: time,
  attachments: [
    {
      entity_type: 'static/image',
      entity_id: id,
      url: 'https://example.com/image',
    },
  ],
};
const discussion = {
  surface: { type: 'channel', id, name: 'Channel', channel_type: 'public' },
  prompt_message_id: id,
  sender: person,
  reply_target: { kind: 'none' },
  thread: { root_id: id, messages: [message], messages_omitted: true },
  channel: [{ root_id: id, messages: [message], messages_omitted: false }],
};
const task = {
  id: 'task-one',
  title: 'Task',
  markdown: '**description**',
  status: 'todo',
  priority: 'high',
  due: time,
  project: { id, name: 'Project' },
  assignees: [person],
};
const document = {
  id: 'document-one',
  name: 'Document',
  file_type: 'md',
  text: '**text**',
};
const call = {
  id,
  title: 'Call',
  channel_name: 'Channel',
  channel_id: id,
  started_at: time,
  ended_at: time,
  participants: [person],
  started_by: person,
  summary: 'Summary <&>',
  transcript: [{ speaker: 'speaker', at: time, text: 'Words' }],
  transcript_omitted: true,
};
const inputs = [];
const addContext = (name, trigger, more = {}) =>
  inputs.push({
    name,
    route: 'agent-context',
    input: {
      promptMarkdown: 'Prompt **body**',
      owner: { id: 'owner', name: 'Owner' },
      trigger,
      ...more,
    },
  });
for (const surface of [
  discussion.surface,
  { type: 'document_comment', id, name: 'Document' },
  { type: 'project_comment', id, name: 'Project' },
  { type: 'crm_company_comment', id, name: 'Company' },
  { type: 'crm_contact_comment', id, name: 'Contact' },
  { type: 'call_chat', id, title: 'Call' },
]) {
  for (const kind of ['conversation', 'mentioned'])
    addContext(`${kind}:${surface.type}`, { kind, ...discussion, surface });
}
for (const addressed_by of ['mention', 'explicit_reply', 'inferred'])
  addContext(`follow-up:${addressed_by}`, {
    kind: 'follow_up',
    addressed_by,
    discussion,
  });
for (const anchor of [
  {
    type: 'spreadsheet',
    sheet_id: 'sheet',
    sheet_name: 'Sheet',
    range: 'A1:B2',
  },
  { type: 'pdf_pin', anchor_id: 'pin' },
  { type: 'pdf_highlight', anchor_id: 'highlight' },
  { type: 'pdf_highlight', anchor_id: 'highlight', marked_text: 'quoted' },
  { type: 'mark', mark_id: 'mark' },
  { type: 'mark', mark_id: 'mark', marked_text: 'old' },
  {
    type: 'mark',
    mark_id: 'mark',
    marked_text: 'old',
    current: { marked_text: 'new', surrounding_text: 'passage' },
  },
])
  addContext(`anchor:${inputs.length}`, {
    kind: 'mentioned',
    ...discussion,
    surface: { type: 'document_comment', id, name: 'Document', anchor },
  });
for (const reply_target of [
  { kind: 'thread', root_id: id },
  { kind: 'quote', message_id: id, thread_id: id, preview: '**preview**' },
  { kind: 'quote', message_id: id, thread_id: id, preview: 'preview', message },
])
  addContext(`target:${inputs.length}`, {
    kind: 'mentioned',
    ...discussion,
    reply_target,
    agent_request: { on_behalf_of: person, hops: 3 },
  });
addContext('task-assigned', {
  kind: 'task_assigned',
  assigned_by: person,
  assigned_at: time,
  discussion_id: id,
  task,
});
addContext('requested', {
  kind: 'requested',
  requested_by: person,
  requested_at: time,
  repo_url: 'https://example.com/repo',
});
addContext('dispatched', {
  kind: 'dispatched',
  dispatched_by: person,
  dispatched_at: time,
  from_bot: null,
  from_session: id,
  repo_url: 'https://example.com/repo',
});
const routine = {
  kind: 'routine',
  routine_id: id,
  name: 'Routine',
  owner: person,
  instructions: '**raw instructions**',
  triggers: [
    { type: 'schedule', cron: '0 * * * *', timezone: 'UTC' },
    { type: 'once', at: time },
    {
      type: 'events',
      events: ['github'],
      entity_ids: [id],
      github: {
        events: ['pull_request'],
        actions: ['opened'],
        repositories: ['example/repo'],
        include_bots: false,
      },
      payload_match: ['value = true'],
      condition: 'Proceed?',
    },
  ],
};
addContext('scheduled', {
  ...routine,
  firing: { type: 'scheduled', scheduled_for: time, schedule: '0 * * * *' },
});
addContext('manual', {
  ...routine,
  firing: { type: 'manual', requested_at: time },
});
const events = [
  { event: 'document_created', document },
  { event: 'document_updated', document },
  { event: 'document_deleted', id: 'document-one', name: 'Document' },
  ...[
    'task_created',
    'task_status_changed',
    'task_priority_changed',
    'task_property_changed',
  ].map((event) => ({
    event,
    task,
    pull_request: {
      url: 'https://example.com/pr',
      github_login: 'placeholder',
    },
  })),
  {
    event: 'email_received',
    email: {
      thread_id: id,
      subject: 'Subject',
      from: 'user@example.com',
      to: ['user@example.com'],
      received_at: time,
      body: '**raw**',
    },
  },
  { event: 'channel_created', id, name: 'Channel' },
  ...[
    'channel_message_posted',
    'channel_mentioned',
    'channel_message_patched',
    'channel_message_attachment_created',
  ].map((event) => ({
    event,
    discussion,
    entity_type: 'document',
    entity_id: 'document-one',
  })),
  { event: 'call_started', call },
  { event: 'call_ended', call },
  {
    event: 'github',
    delivery: {
      event: 'push',
      action: 'opened',
      repository: 'example/repo',
      sender: 'placeholder',
      payload: {
        '17': 'integer key',
        '0': 'first',
        value: '<&>',
        n: 9007199254740992,
      },
    },
  },
  { event: 'github', delivery: { event: 'push' } },
];
for (const event of events)
  addContext(`routine:${event.event}:${inputs.length}`, {
    ...routine,
    firing: { type: 'event', event, conditions: ['Ready?', 'Allowed?'] },
  });
for (const timeZone of ['UTC', 'America/New_York', undefined])
  inputs.push({
    name: `time:${timeZone}`,
    route: 'agent-context',
    input: {
      promptMarkdown: '<m-agent-context>user</m-agent-context>',
      instructions: '\ufeff private <&> \n',
      owner: { id: 'owner', name: 'Owner' },
      sender: { id: 'sender', name: 'Sender' },
      currentTime: {
        iso: '2026-11-07T12:00:00Z',
        local: 'Local time',
        timeZone,
      },
    },
  });
for (const body of [
  { kind: 'pending' },
  { kind: 'markdown', markdown: 'authored body' },
  {
    kind: 'segments',
    segments: [
      { kind: 'prose', markdown: 'prose' },
      { kind: 'activity', turn: 0, segment: 1, rows: [], sealed: false },
    ],
    pending: true,
    footer: 'Done',
  },
])
  inputs.push({
    name: `chat:${body.kind}`,
    route: 'chat',
    input: { sessionId: 'session', body },
  });
inputs.push({
  name: 'connection',
  route: 'connection',
  input: {
    agentTag: 'agent',
    message: 'Connect account',
    chip: { appSlug: 'example', name: 'Example', target: 'connections' },
  },
});
inputs.push({
  name: 'announcement',
  route: 'announcement',
  input: {
    replyTarget: {
      parent: { type: 'channel', id },
      targetMessageId: id,
      targetThreadId: id,
      senderId: 'sender',
      displayText: '  A \n reply  ',
    },
    chip: { agentSessionId: 'session', status: 'acp_ready' },
  },
});
inputs.push({
  name: 'image',
  route: 'image',
  input: {
    staticFileId: id,
    url: 'https://example.com/image.png',
    width: 800,
    height: 600,
  },
});
addContext('wire-verbatim-times-and-ids', {
  kind: 'requested',
  requested_by: person,
  requested_at: 'supplied time',
});
addContext('wire-empty-event-filters', {
  ...routine,
  triggers: [
    {
      type: 'events',
      events: [],
      entity_ids: [],
      github: {
        events: [],
        actions: [],
        repositories: [],
        include_bots: false,
      },
    },
  ],
  firing: { type: 'manual', requested_at: time },
});
const functions = {
  'agent-context': context.composeAgentContextPrompt,
  chat: replies.composeAgentChatReply,
  connection: connection.composeAgentConnectionPrompt,
  image: image.composeImageMarkdown,
  announcement: announcement.composeAgentSessionAnnouncement,
};
const rows = inputs.map((row) => {
  let expected;
  try {
    expected = { value: functions[row.route](row.input) };
  } catch {
    expected = { throws: true };
  }
  return JSON.stringify({ ...row, expected });
});
const { AgentAnnouncementEndpoint } = await import(
  root + 'services/lexical-service/src/endpoints/agent-announcement.ts'
);
const chip = {
  agentSessionId: 'session',
  promptedMessage: { turn: 0, author: 'user' },
  status: 'acp_ready',
};
const targetData = {
  parent: { type: 'channel', id: 'channel' },
  targetMessageId: 'message',
  targetThreadId: 'thread',
  displayText: ' A \n reply ',
  senderId: 'sender',
};
const chatReply = { sessionId: 'session', body: { kind: 'pending' } };
const connectionPrompt = {
  agentTag: 'agent',
  message: 'Connect',
  chip: { appSlug: 'example', name: 'Example', target: 'connections' },
};
const endpointInputs = [
  { chip },
  { chip, replyTarget: targetData },
  {
    chip,
    replyTarget: { ...targetData, parent: undefined, channelId: 'channel' },
  },
  { chip, replyTarget: { ...targetData, parent: undefined, channelId: '' } },
  { chip, replyTarget: { ...targetData, parent: undefined } },
  { chip, replyTarget: { ...targetData, parent: { type: 'channel', id: '' } } },
  { chip, replyTarget: null },
  { chip: { ...chip, promptedMessage: undefined } },
  { chip: { ...chip, promptedMessage: null } },
  { chip: { ...chip, promptedMessage: { turn: -1, author: 'user' } } },
  { chip: { ...chip, channelId: null } },
  { chip, chatReply, connectionPrompt },
  { chatReply, connectionPrompt },
  { chatReply },
  { chatReply: { ...chatReply, sessionId: '' } },
  { chatReply: { ...chatReply, link: null } },
  { chatReply: { sessionId: 'session' } },
  { connectionPrompt },
  { connectionPrompt: { ...connectionPrompt, agentTag: '' } },
  {
    connectionPrompt: {
      ...connectionPrompt,
      chip: { ...connectionPrompt.chip, appSlug: 'Invalid' },
    },
  },
];
for (const card of [
  null,
  { kind: 'unknown', future: 1 },
  { kind: 'view', view: null },
  { kind: 'view', view: { version: 1, widgets: [] }, future: 1 },
])
  endpointInputs.push({
    chatReply: {
      sessionId: 'session',
      body: {
        kind: 'segments',
        segments: [
          {
            kind: 'activity',
            turn: 0,
            segment: 0,
            rows: [
              {
                id: 'row',
                label: 'View',
                status: 'completed',
                card,
                unknown: 'stripped',
              },
            ],
            sealed: true,
          },
        ],
      },
    },
  });
for (const input of endpointInputs) {
  let expected;
  try {
    const endpoint = new AgentAnnouncementEndpoint({});
    const body =
      endpoint.schema.request.body.content['application/json'].schema.parse(
        input
      );
    endpoint.getValidatedData = async () => ({ body });
    const result = await endpoint.handle({ json: (value) => value });
    if (typeof result.markdown !== 'string')
      throw Error('Source route rejected render');
    expected = { value: result.markdown };
  } catch {
    expected = { throws: true };
  }
  rows.push(
    JSON.stringify({
      name: `endpoint:${rows.length}`,
      route: 'endpoint-announcement',
      input,
      expected,
    })
  );
}
const target =
  root + 'crates/macro_document_composers/tests/corpus/composers.jsonl';
const text = rows.join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text)
    throw new Error('Composer oracle drift');
} else writeFileSync(target, text);
console.log(`Checked ${rows.length} source composer goldens`);

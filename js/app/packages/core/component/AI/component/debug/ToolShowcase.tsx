import type { ToolName } from '@service-cognition/generated/tools/tool';
import { For } from 'solid-js';
import { ChatInputProvider, ChatProvider } from '../../context';
import { RenderTool } from '../tool/handler';
import { McpToolCall } from '../tool/McpToolCall';
import { Tool } from '../tool/Tool';

type ToolCase = {
  name: ToolName;
  json: unknown;
  response?: unknown;
};

const uuid = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

const now = '2026-06-01T19:00:00.000Z';

const common = {
  channelId: uuid(1),
  chatId: uuid(2),
  documentId: uuid(3),
  messageId: uuid(4),
  threadId: uuid(5),
  callId: uuid(6),
  labelId: uuid(7),
  propertyId: uuid(8),
  notificationId: uuid(9),
};

const toolCases: ToolCase[] = [
  {
    name: 'ListEntities',
    json: { includeTypes: ['channel'], limit: 20, sortBy: 'recently_updated' },
    response: {
      items: [
        { id: common.channelId, name: 'macro', type: 'channel' },
        { id: uuid(10), name: 'battlefield', type: 'channel' },
        { id: uuid(11), name: 'CHUD FARM', type: 'channel' },
      ],
      summary: '3 channels',
    },
  },
  {
    name: 'ContentSearch',
    json: { entityTypes: ['channels'], query: 'chud' },
    response: {
      results: [
        {
          channel_id: common.channelId,
          channel_message_search_results: [
            {
              created_at: now,
              highlight: {
                content: ['deployment to <em>chudville</em>.com?'],
              },
              message_id: common.messageId,
              sender_id: 'macro|alex@example.com',
              thread_id: common.threadId,
              updated_at: now,
            },
          ],
          channel_type: 'public',
          id: common.channelId,
          metadata: null,
          owner_id: 'macro|alex@example.com',
          type: 'channel',
        },
      ],
    },
  },
  {
    name: 'NameSearch',
    json: { entityTypes: ['channels'], name: 'can you' },
    response: { results: [] },
  },
  {
    name: 'ReadChannelMessages',
    json: {
      channelId: common.channelId,
      includeThreadPreviews: true,
      limit: 30,
      windowType: 'latest',
    },
  },
  {
    name: 'ReadChannelThread',
    json: {
      channelId: common.channelId,
      includeChannelContext: false,
      limit: 12,
      messageId: common.messageId,
      windowType: 'latest',
    },
  },
  {
    name: 'ReadChannelMessageContext',
    json: {
      channelAfter: 3,
      channelBefore: 3,
      channelId: common.channelId,
      messageId: common.messageId,
      threadAfter: 6,
      threadBefore: 6,
    },
  },
  {
    name: 'GetThread',
    json: { limit: 5, threadId: common.threadId },
    response: {
      isRead: true,
      messages: [
        {
          bodyParsed: 'Can we move this forward today?',
          cc: [],
          date: now,
          from: { email: 'alex@example.com', name: 'Alex' },
          id: common.messageId,
          subject: 'Project status',
          to: [{ email: 'seamy@example.com', name: 'Seamy' }],
        },
      ],
      summary: '1 message',
      threadId: common.threadId,
    },
  },
  {
    name: 'ReadThread',
    json: {
      contentType: 'channel',
      ids: [common.channelId],
      messagesSince: null,
    },
    response: {
      content: {
        channel_id: common.channelId,
        channel_name: 'macro',
        transcript: 'Alex: The reference list is ready.',
        type: 'channel',
      },
    },
  },
  {
    name: 'ReadChat',
    json: { chatId: common.chatId },
  },
  {
    name: 'ReadContent',
    json: { documentId: common.documentId },
  },
  {
    name: 'ReadMetadata',
    json: { documentId: common.documentId },
  },
  {
    name: 'CreateDocument',
    json: {
      documentName: 'Tool styling notes',
      fileContent: '# Tool styling notes\n',
      fileExtension: 'md',
      isTask: false,
    },
  },
  {
    name: 'GetEntityProperties',
    json: { entity_id: common.documentId, entity_type: 'document' },
    response: {
      properties: [
        {
          currentValue: 'High',
          dataType: 'select',
          displayName: 'Priority',
          isMultiSelect: false,
          isSystem: false,
          options: [
            {
              displayOrder: 0,
              displayValue: 'High',
              id: uuid(12),
            },
          ],
          propertyDefinitionId: common.propertyId,
        },
      ],
      summary: '1 property',
    },
  },
  {
    name: 'SetEntityProperty',
    json: {
      entity_id: common.documentId,
      entity_type: 'document',
      property_definition_id: common.propertyId,
      string_value: 'High',
    },
    response: { message: 'Updated Priority', success: true },
  },
  {
    name: 'ListLabels',
    json: {},
    response: {
      labels: [{ id: common.labelId, name: 'Needs follow-up', type: 'task' }],
      summary: '1 label',
    },
  },
  {
    name: 'UpdateThreadLabels',
    json: { add: true, label_id: common.labelId, thread_id: common.threadId },
    response: {
      failedCount: 0,
      successfulCount: 1,
      summary: 'Added label to thread',
    },
  },
  {
    name: 'ListNotifications',
    json: {
      done: false,
      entities: null,
      includeTypes: ['email', 'message'],
      limit: 10,
      seen: null,
    },
    response: {
      hasMore: false,
      notifications: [
        {
          createdAt: now,
          done: false,
          entityId: common.threadId,
          entityType: 'email',
          eventType: 'reply',
          id: common.notificationId,
          metadata: { subject: 'Project status' },
          seen: false,
          senderId: 'alex',
        },
      ],
    },
  },
  {
    name: 'MarkNotificationsDone',
    json: { done: true, notificationIds: [common.notificationId] },
    response: { count: 1, success: true },
  },
  {
    name: 'MarkNotificationsSeen',
    json: { notificationIds: [common.notificationId] },
    response: { count: 1, success: true },
  },
  {
    name: 'ListTeamMembers',
    json: {},
    response: {
      invited: [{ email: 'pending@example.com', role: 'member' }],
      members: [{ role: 'admin', userId: 'macro|alex@example.com' }],
    },
  },
  {
    name: 'ListCallRecords',
    json: { attended: null, channelId: common.channelId },
    response: {
      records: [
        {
          callId: common.callId,
          channelId: common.channelId,
          channelName: 'macro',
          createdBy: 'alex',
          durationMs: 1800000,
          endedAt: now,
          isActive: false,
          participants: ['alex', 'seamy'],
          startedAt: now,
        },
      ],
    },
  },
  {
    name: 'ReadCallRecord',
    json: { callId: common.callId },
    response: {
      callId: common.callId,
      summary: 'Discussed compact tool rows.',
      transcript: [
        {
          content: 'The result toggle should be quieter.',
          diarizedSpeakerId: null,
          endedAt: now,
          speakerId: 'alex',
          startedAt: now,
        },
      ],
    },
  },
  {
    name: 'BashCodeExecution',
    json: { input: "printf 'hello\\n'" },
    response: {
      content: {
        content: null,
        return_code: 0,
        stderr: '',
        stdout: 'hello\n',
        type: 'bash_code_execution_result',
      },
      tool_use_id: 'bash-tool-use',
    },
  },
  {
    name: 'TextEditorCodeExecution',
    json: { input: 'Create src/example.ts with a hello function' },
    response: {
      content: {
        content: 'export function hello() { return "hello"; }',
        file_type: 'ts',
        is_file_update: true,
        lines: ['export function hello() { return "hello"; }'],
        newLines: 1,
        newStart: 1,
        oldLines: 0,
        oldStart: 1,
        type: 'text_editor_code_execution_create_result',
      },
      tool_use_id: 'text-editor-tool-use',
    },
  },
  {
    name: 'WebSearch',
    json: { input: 'Macro app component registry' },
    response: {
      content: [
        {
          page_age: '1 day ago',
          title: 'Macro component registry',
          type: 'web_search_result',
          url: 'https://example.com/registry',
        },
      ],
      tool_use_id: 'web-search-tool-use',
    },
  },
  {
    name: 'WebFetch',
    json: { input: 'https://example.com/registry' },
    response: {
      content: {
        content: {
          source: {
            data: 'Component registry notes',
            media_type: 'text/plain',
            type: 'text',
          },
          title: 'Registry',
        },
        retrieved_at: now,
        type: 'web_fetch_result',
        url: 'https://example.com/registry',
      },
      tool_use_id: 'web-fetch-tool-use',
    },
  },
  {
    name: 'Subagent',
    json: { task: 'Summarize unread channel requests' },
    response: {
      result: 'Found three follow-ups and one open question.',
    },
  },
  {
    name: 'SendEmail',
    json: {
      bcc: [],
      body: 'Sharing the compact tool-call pass.',
      cc: [],
      replyingToId: null,
      subject: 'Tool call updates',
      to: [{ email: 'alex@example.com', name: 'Alex' }],
    },
    response: 'Rejected',
  },
];

function ToolCaseRow(props: {
  item: ToolCase;
  index: number;
  grouped?: boolean;
}) {
  const id = () => `tool-showcase-${props.index}`;
  const renderContext = () => ({
    renderContext: {
      grouped: props.grouped,
      isStreaming: !props.item.response,
    },
  });

  return (
    <RenderTool
      chat_id="tool-showcase-chat"
      isComplete={Boolean(props.item.response)}
      json={props.item.json}
      message_id="tool-showcase-message"
      name={props.item.name}
      part_index={props.index}
      renderContext={renderContext()}
      response={
        props.item.response
          ? { json: props.item.response, name: props.item.name }
          : undefined
      }
      tool_id={id()}
    />
  );
}

function Section(props: { title: string; children: any }) {
  return (
    <section class="space-y-3">
      <h2 class="px-1 text-xs font-medium text-ink-extra-muted">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

export default function ToolShowcase() {
  return (
    <ChatInputProvider>
      <ChatProvider chatId="tool-showcase-chat" messages={[]}>
        <div class="size-full overflow-auto bg-background">
          <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
            <Section title="Grouped Tool Calls">
              <Tool.Group>
                <For each={toolCases}>
                  {(item, index) => (
                    <ToolCaseRow grouped index={index()} item={item} />
                  )}
                </For>
                <McpToolCall
                  display_name="Create issue"
                  isComplete
                  name="linear_create_issue"
                  renderContext={{
                    renderContext: { grouped: true, isStreaming: false },
                  }}
                  service="linear"
                />
              </Tool.Group>
            </Section>

            <Section title="Single Tool Rows">
              <div class="space-y-2">
                <For each={toolCases.slice(0, 6)}>
                  {(item, index) => (
                    <ToolCaseRow index={index() + 100} item={item} />
                  )}
                </For>
              </div>
            </Section>
          </div>
        </div>
      </ChatProvider>
    </ChatInputProvider>
  );
}

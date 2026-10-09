import { describe, expect, it } from 'bun:test';
import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import {
  AgentContextEndpoint,
  agentContextRequest,
} from '../src/endpoints/agent-context';

// The wire examples in crates/trigger_context/src/test.rs.
const followUpWire = {
  kind: 'follow_up',
  addressed_by: 'explicit_reply',
  discussion: {
    surface: {
      type: 'channel',
      id: '00000000-0000-0000-0000-0000000000c1',
      name: 'eng',
      channel_type: 'public',
    },
    prompt_message_id: '00000000-0000-0000-0000-000000000003',
    sender: {
      id: 'macro|julia@example.com',
      name: 'Julia',
      email: 'julia@example.com',
    },
    reply_target: {
      kind: 'quote',
      message_id: '00000000-0000-0000-0000-000000000002',
      thread_id: '00000000-0000-0000-0000-000000000001',
      preview: 'The popover scrolls the page',
    },
    thread: {
      root_id: '00000000-0000-0000-0000-000000000001',
      messages: [
        {
          id: '00000000-0000-0000-0000-000000000003',
          author: {
            id: 'macro|julia@example.com',
            name: 'Julia',
            email: 'julia@example.com',
          },
          content: 'please fix',
          posted_at: '2026-10-08T14:02:00Z',
        },
      ],
      messages_omitted: false,
    },
  },
};

const taskAssignedWire = {
  kind: 'task_assigned',
  task: {
    id: 'task-1',
    title: 'Fix calendar popover scroll',
    markdown: 'The popover scrolls the page behind it.',
    status: 'Todo',
    priority: 'High',
    due: '2026-10-10T00:00:00Z',
    assignees: [
      {
        id: 'bot|00000000-0000-0000-0000-00000000c5c5',
        name: 'Cursor',
      },
    ],
    project: {
      id: '00000000-0000-0000-0000-0000000000a1',
      name: 'Calendar polish',
    },
  },
  assigned_by: {
    id: 'macro|julia@example.com',
    name: 'Julia',
    email: 'julia@example.com',
  },
  assigned_at: '2026-10-08T14:02:00Z',
  discussion_id: '00000000-0000-0000-0000-0000000000d1',
};

// Rust serializes DispatchedContext.from_bot as null when absent.
const dispatchedWire = {
  kind: 'dispatched',
  dispatched_by: { id: 'macro|julia@example.com', name: 'Julia' },
  dispatched_at: '2026-10-08T14:02:00Z',
  from_bot: null,
};

function endpoint() {
  const app = new Hono();
  fromHono(app).post('/agent-context', AgentContextEndpoint);
  return (body: unknown) =>
    app.request('/agent-context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
}

describe('agent-context request schema', () => {
  it('accepts each Rust wire example as the trigger, unchanged', () => {
    for (const trigger of [followUpWire, taskAssignedWire, dispatchedWire]) {
      const parsed = agentContextRequest.safeParse({
        promptMarkdown: 'please fix',
        trigger,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.trigger).toEqual(trigger);
    }
  });

  it('still accepts the legacy conversation fields on their own', () => {
    const parsed = agentContextRequest.safeParse({
      promptMarkdown: 'please fix',
      parent: { type: 'channel', id: 'c1' },
      replyTarget: { kind: 'none' },
      promptMessageId: 'p',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a trigger beside any legacy conversation field', () => {
    for (const legacy of [
      { parent: { type: 'channel', id: 'c1' } },
      { promptMessageId: 'p' },
      { replyTarget: { kind: 'none' } },
      { anchor: { markId: 'mark-1' } },
      { thread: { rootId: 'a', messages: [], messagesOmitted: false } },
      { channel: [] },
    ]) {
      const parsed = agentContextRequest.safeParse({
        promptMarkdown: 'please fix',
        trigger: followUpWire,
        ...legacy,
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe('POST /agent-context', () => {
  it('composes a prompt from each Rust wire example', async () => {
    const post = endpoint();
    for (const trigger of [followUpWire, taskAssignedWire, dispatchedWire]) {
      const response = await post({ promptMarkdown: 'please fix', trigger });
      expect(response.status).toBe(200);
      const { markdown } = (await response.json()) as { markdown: string };
      expect(markdown).toStartWith('<m-agent-context>');
      expect(markdown).toContain(`trigger kind=\\"${trigger.kind}\\"`);
    }
  });

  it('answers 400 to a trigger mixed with legacy fields', async () => {
    const response = await endpoint()({
      promptMarkdown: 'please fix',
      trigger: taskAssignedWire,
      parent: { type: 'channel', id: 'c1' },
    });
    expect(response.status).toBe(400);
  });
});

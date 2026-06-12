/**
 * @vitest-environment jsdom
 */

import { asChatMessage } from '@core/component/AI/util/message';
import type { ChatStream } from '@service-cognition/generated/schemas';
import type { AssistantMessagePart } from '@service-cognition/generated/schemas/assistantMessagePart';
import { render, waitFor } from '@solidjs/testing-library';
import { createMemo, createRoot, createSignal, type JSX, Show } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessageParts } from './AssistantMessageParts';

const lifecycle = vi.hoisted(() => ({
  markdownCleanups: 0,
  markdownMounts: 0,
  mcpCleanups: new Map<string, number>(),
  mcpMounts: new Map<string, number>(),
  thinkingCleanups: 0,
  thinkingMounts: 0,
  toolCleanups: new Map<string, number>(),
  toolMounts: new Map<string, number>(),
}));

vi.mock('@core/component/AI/context', () => ({
  useChatContext: () => ({
    chatId: () => 'chat-1',
  }),
}));

vi.mock('@core/component/AI/component/tool/Tool', () => ({
  Tool: {
    Group: (props: { children: JSX.Element }) => (
      <div data-testid="tool-group">{props.children}</div>
    ),
  },
}));

vi.mock(
  '@core/component/AI/component/message/ChatMessageMarkdown',
  async () => {
    const solid = await vi.importActual<typeof import('solid-js')>('solid-js');

    return {
      ChatMessageMarkdown: (props: { text: string }) => {
        solid.onMount(() => {
          lifecycle.markdownMounts += 1;
        });
        solid.onCleanup(() => {
          lifecycle.markdownCleanups += 1;
        });
        return <div data-testid="markdown">{props.text}</div>;
      },
    };
  }
);

vi.mock('@core/component/AI/component/message/ThinkingBlock', async () => {
  const solid = await vi.importActual<typeof import('solid-js')>('solid-js');

  return {
    ThinkingBlock: (props: { thinking: string; isStreaming: boolean }) => {
      solid.onMount(() => {
        lifecycle.thinkingMounts += 1;
      });
      solid.onCleanup(() => {
        lifecycle.thinkingCleanups += 1;
      });
      return (
        <div data-testid="thinking" data-streaming={String(props.isStreaming)}>
          {props.thinking}
        </div>
      );
    },
  };
});

vi.mock('@core/component/AI/component/tool/handler', async () => {
  const solid = await vi.importActual<typeof import('solid-js')>('solid-js');

  return {
    RenderTool: (props: { tool_id: string; isComplete: boolean }) => {
      solid.onMount(() => {
        lifecycle.toolMounts.set(
          props.tool_id,
          (lifecycle.toolMounts.get(props.tool_id) ?? 0) + 1
        );
      });
      solid.onCleanup(() => {
        lifecycle.toolCleanups.set(
          props.tool_id,
          (lifecycle.toolCleanups.get(props.tool_id) ?? 0) + 1
        );
      });
      return (
        <div data-complete={String(props.isComplete)} data-testid="tool">
          {props.tool_id}
        </div>
      );
    },
    triggerToolCall: vi.fn(),
  };
});

vi.mock('@core/component/AI/component/tool/McpToolCall', async () => {
  const solid = await vi.importActual<typeof import('solid-js')>('solid-js');

  return {
    McpToolCall: (props: { name: string }) => {
      solid.onMount(() => {
        lifecycle.mcpMounts.set(
          props.name,
          (lifecycle.mcpMounts.get(props.name) ?? 0) + 1
        );
      });
      solid.onCleanup(() => {
        lifecycle.mcpCleanups.set(
          props.name,
          (lifecycle.mcpCleanups.get(props.name) ?? 0) + 1
        );
      });
      return <div data-testid="mcp-tool">{props.name}</div>;
    },
  };
});

function response(
  content: Extract<ChatStream, { type: 'chat_message_response' }>['content']
): ChatStream {
  return {
    chat_id: 'chat-1',
    content,
    message_id: 'message-1',
    stream_id: 'message-1',
    type: 'chat_message_response',
  };
}

function StreamedAssistantParts(props: { data: () => ChatStream[] }) {
  const message = createMemo(() => asChatMessage(props.data()));

  return (
    <Show when={message()}>
      {(msg) => (
        <AssistantMessageParts
          parts={msg().content as AssistantMessagePart[]}
          message={msg()}
          isStreaming
        />
      )}
    </Show>
  );
}

describe('AssistantMessageParts streaming identity', () => {
  beforeEach(() => {
    lifecycle.markdownCleanups = 0;
    lifecycle.markdownMounts = 0;
    lifecycle.mcpCleanups.clear();
    lifecycle.mcpMounts.clear();
    lifecycle.thinkingCleanups = 0;
    lifecycle.thinkingMounts = 0;
    lifecycle.toolCleanups.clear();
    lifecycle.toolMounts.clear();
  });

  it('keeps mixed streamed parts mounted as later chunks arrive', async () => {
    let append!: (item: ChatStream) => void;
    let disposeStream!: () => void;
    const data = createRoot((dispose) => {
      disposeStream = dispose;
      const [items, setItems] = createSignal<ChatStream[]>([]);
      append = (item) => setItems((prev) => [...prev, item]);
      return items;
    });

    render(() => <StreamedAssistantParts data={data} />);

    append(response({ thinking: 'Need', type: 'thinking' }));
    await waitFor(() => expect(lifecycle.thinkingMounts).toBe(1));

    append(response({ thinking: ' context', type: 'thinking' }));
    await waitFor(() => {
      expect(lifecycle.thinkingMounts).toBe(1);
      expect(lifecycle.thinkingCleanups).toBe(0);
    });

    append(
      response({
        id: 'tool-1',
        json: { channelId: 'channel-1' },
        name: 'ReadChannelMessages',
        type: 'toolCall',
      })
    );
    await waitFor(() => expect(lifecycle.toolMounts.get('tool-1')).toBe(1));
    expect(lifecycle.thinkingMounts).toBe(1);
    expect(lifecycle.thinkingCleanups).toBe(0);

    append(
      response({
        id: 'tool-1',
        json: { messages: [] },
        name: 'ReadChannelMessages',
        type: 'toolCallResponseJson',
      })
    );
    await waitFor(() => {
      expect(lifecycle.toolMounts.get('tool-1')).toBe(1);
      expect(lifecycle.toolCleanups.get('tool-1') ?? 0).toBe(0);
    });

    append(
      response({
        display_name: 'Search issues',
        id: 'mcp-1',
        json: { query: 'streaming' },
        name: 'search',
        service: 'linear',
        type: 'mcpToolCall',
      })
    );
    await waitFor(() => expect(lifecycle.mcpMounts.get('search')).toBe(1));
    expect(lifecycle.toolMounts.get('tool-1')).toBe(1);
    expect(lifecycle.toolCleanups.get('tool-1') ?? 0).toBe(0);

    append(response({ text: 'Done', type: 'text' }));
    await waitFor(() => expect(lifecycle.markdownMounts).toBe(1));
    expect(lifecycle.mcpMounts.get('search')).toBe(1);
    expect(lifecycle.mcpCleanups.get('search') ?? 0).toBe(0);

    append(response({ text: '.', type: 'text' }));
    await waitFor(() => {
      expect(lifecycle.markdownMounts).toBe(1);
      expect(lifecycle.markdownCleanups).toBe(0);
    });

    expect(lifecycle.thinkingMounts).toBe(1);
    expect(lifecycle.thinkingCleanups).toBe(0);
    expect(lifecycle.toolMounts.get('tool-1')).toBe(1);
    expect(lifecycle.toolCleanups.get('tool-1') ?? 0).toBe(0);
    expect(lifecycle.mcpMounts.get('search')).toBe(1);
    expect(lifecycle.mcpCleanups.get('search') ?? 0).toBe(0);
    disposeStream();
  });
});

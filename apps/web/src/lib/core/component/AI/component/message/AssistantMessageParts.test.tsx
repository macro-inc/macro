/**
 * @vitest-environment jsdom
 */

import { asChatMessage } from '@core/component/AI/util/message';
import type { ChatStream } from '@service-cognition/generated/schemas';
import type { AssistantMessagePart } from '@service-cognition/generated/schemas/assistantMessagePart';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import { createMemo, createRoot, createSignal, type JSX, Show } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessageParts } from './AssistantMessageParts';

const lifecycle = vi.hoisted(() => ({
  markdownCleanups: 0,
  markdownMounts: 0,
  mcpCleanups: new Map<string, number>(),
  mcpMounts: new Map<string, number>(),
  streamTailStateUpdates: [] as Array<{
    state: unknown;
    key: string | undefined;
  }>,
  thinkingCleanups: 0,
  thinkingMounts: 0,
  toolCleanups: new Map<string, number>(),
  toolMounts: new Map<string, number>(),
}));

vi.mock('@core/component/AI/context', () => ({
  useChatContext: () => ({
    chatId: () => 'chat-1',
    setStreamTailState: (state: unknown, key?: string) => {
      lifecycle.streamTailStateUpdates.push({ state, key });
    },
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
      ChatMessageMarkdown: (props: {
        text: string;
        setStateRef?: (state: unknown, key?: string) => void;
        stateRefKey?: string;
      }) => {
        solid.onMount(() => {
          lifecycle.markdownMounts += 1;
        });
        solid.onCleanup(() => {
          lifecycle.markdownCleanups += 1;
        });
        solid.createEffect(() => {
          const setStateRef = props.setStateRef;
          const key = props.stateRefKey;
          if (!setStateRef) return;
          setStateRef(() => null, key);
          solid.onCleanup(() => setStateRef(undefined, key));
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
    lifecycle.streamTailStateUpdates = [];
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

    const rendered = render(() => <StreamedAssistantParts data={data} />);

    append(response({ thinking: 'Need', type: 'thinking' }));
    await waitFor(() => expect(lifecycle.thinkingMounts).toBe(1));
    expect(rendered.queryByTestId('activity-toggle')).toBeNull();

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
    expect(rendered.getByTestId('activity-toggle').textContent).toContain(
      '2 steps'
    );
    expect(rendered.getByTestId('activity-content').classList).toContain(
      'hidden'
    );
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

  it('collapses heterogeneous activity until the user expands it', async () => {
    const parts: AssistantMessagePart[] = [
      { thinking: 'Check the channel', type: 'thinking' },
      {
        id: 'tool-1',
        json: { channelId: 'channel-1' },
        name: 'ReadChannelMessages',
        type: 'toolCall',
      },
      {
        id: 'tool-1',
        json: { messages: [] },
        name: 'ReadChannelMessages',
        type: 'toolCallResponseJson',
      },
      {
        display_name: 'Search issues',
        id: 'mcp-1',
        json: { query: 'streaming' },
        name: 'search',
        service: 'linear',
        type: 'mcpToolCall',
      },
      { text: 'Done', type: 'text' },
    ];
    const rendered = render(() => (
      <AssistantMessageParts
        parts={parts}
        message={{
          attachments: [],
          content: parts,
          id: 'message-1',
          role: 'assistant',
        }}
        isStreaming={false}
      />
    ));

    const toggle = rendered.getByTestId('activity-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rendered.getByTestId('activity-content').classList).toContain(
      'hidden'
    );
    expect(rendered.getByTestId('thinking')).toBeTruthy();
    expect(rendered.getByTestId('tool')).toBeTruthy();
    expect(rendered.getByTestId('mcp-tool')).toBeTruthy();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.getByTestId('activity-content').classList).not.toContain(
      'hidden'
    );
    expect(rendered.getByTestId('thinking').textContent).toBe(
      'Check the channel'
    );
    expect(rendered.getByTestId('tool').textContent).toBe('tool-1');
    expect(rendered.getByTestId('mcp-tool').textContent).toBe('search');
    expect(rendered.getByTestId('markdown').textContent).toBe('Done');
  });

  it('does not group isolated activity separated by visible answer text', () => {
    const parts: AssistantMessagePart[] = [
      { thinking: 'First thought', type: 'thinking' },
      { text: 'Interim answer', type: 'text' },
      {
        id: 'tool-1',
        json: { query: 'mentions' },
        name: 'Search',
        type: 'toolCall',
      },
    ];
    const rendered = render(() => (
      <AssistantMessageParts
        parts={parts}
        message={{
          attachments: [],
          content: parts,
          id: 'message-1',
          role: 'assistant',
        }}
        isStreaming={false}
      />
    ));

    expect(rendered.queryByTestId('activity-toggle')).toBeNull();
    expect(rendered.getByTestId('thinking').textContent).toBe('First thought');
    expect(rendered.getByTestId('tool').textContent).toBe('tool-1');
    expect(rendered.getByTestId('markdown').textContent).toBe('Interim answer');
  });

  it('previews only the latest activity group while streaming', async () => {
    let append!: (item: ChatStream) => void;
    let disposeStream!: () => void;
    const data = createRoot((dispose) => {
      disposeStream = dispose;
      const [items, setItems] = createSignal<ChatStream[]>([]);
      append = (item) => setItems((prev) => [...prev, item]);
      return items;
    });
    const rendered = render(() => <StreamedAssistantParts data={data} />);

    append(response({ thinking: 'Need some context', type: 'thinking' }));
    await waitFor(() =>
      expect(rendered.queryByTestId('activity-preview')).toBeNull()
    );

    append(
      response({
        id: 'tool-1',
        json: { query: 'mentions' },
        name: 'Search',
        type: 'toolCall',
      })
    );
    await waitFor(() =>
      expect(rendered.getByTestId('activity-preview').textContent).toBe(
        'Search'
      )
    );

    append(response({ text: 'Interim answer', type: 'text' }));
    await waitFor(() =>
      expect(rendered.queryByTestId('activity-preview')).toBeNull()
    );

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
    await waitFor(() =>
      expect(rendered.queryByTestId('activity-preview')).toBeNull()
    );

    append(response({ thinking: 'Review the results', type: 'thinking' }));
    await waitFor(() =>
      expect(rendered.getByTestId('activity-preview').textContent).toBe(
        'Review the results'
      )
    );
    disposeStream();
  });

  it('registers resumed markdown as the stream tail after a hidden tool response', async () => {
    let append!: (item: ChatStream) => void;
    let disposeStream!: () => void;
    const data = createRoot((dispose) => {
      disposeStream = dispose;
      const [items, setItems] = createSignal<ChatStream[]>([]);
      append = (item) => setItems((prev) => [...prev, item]);
      return items;
    });

    render(() => <StreamedAssistantParts data={data} />);

    append(response({ text: '```ts\n', type: 'text' }));
    await waitFor(() =>
      expect(
        lifecycle.streamTailStateUpdates.some(
          (update) =>
            typeof update.state === 'function' &&
            update.key === 'message-1:text:0'
        )
      ).toBe(true)
    );

    append(
      response({
        id: 'tool-1',
        json: { query: 'mentions' },
        name: 'Search',
        type: 'toolCall',
      })
    );
    await waitFor(() =>
      expect(
        lifecycle.streamTailStateUpdates.some(
          (update) => update.state === undefined
        )
      ).toBe(true)
    );

    append(
      response({
        id: 'tool-1',
        json: { results: [] },
        name: 'Search',
        type: 'toolCallResponseJson',
      })
    );

    append(response({ text: '<m-document-mention>', type: 'text' }));
    await waitFor(() =>
      expect(
        lifecycle.streamTailStateUpdates.some(
          (update) =>
            typeof update.state === 'function' &&
            update.key === 'message-1:text:1'
        )
      ).toBe(true)
    );
    disposeStream();
  });
});

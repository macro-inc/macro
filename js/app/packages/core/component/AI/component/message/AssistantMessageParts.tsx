import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { ThinkingBlock } from '@core/component/AI/component/message/ThinkingBlock';
import { RenderTool } from '@core/component/AI/component/tool/handler';
import { McpToolCall } from '@core/component/AI/component/tool/McpToolCall';
import { Tool } from '@core/component/AI/component/tool/Tool';
import { useChatContext } from '@core/component/AI/context';
import type { AssistantMessagePart } from '@service-cognition/generated/schemas/assistantMessagePart';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
import {
  type Accessor,
  createMemo,
  createSelector,
  Match,
  mapArray,
  Show,
  Switch,
} from 'solid-js';

function getAssistantPartKey(
  part: AssistantMessagePart,
  counts: Map<AssistantMessagePart['type'], number>
): string {
  if (
    part.type === 'toolCall' ||
    part.type === 'toolCallErr' ||
    part.type === 'mcpToolCall'
  ) {
    return `${part.type}:${part.id}`;
  }

  const count = counts.get(part.type) ?? 0;
  counts.set(part.type, count + 1);
  return `${part.type}:${count}`;
}

type ToolGroupEntry = {
  key: string;
  part: Extract<AssistantMessagePart, { type: 'toolCall' | 'mcpToolCall' }>;
  index: number;
};

type RenderItem =
  | {
      type: 'toolGroup';
      key: string;
      entries: ToolGroupEntry[];
    }
  | {
      type: 'part';
      key: string;
      part: AssistantMessagePart;
      index: number;
    };

export function AssistantMessageParts(props: {
  parts: AssistantMessagePart[];
  message: ChatMessageWithAttachments;
  isStreaming: boolean;
}) {
  const outer = props;
  const chat = useChatContext();
  const completedToolIds = createMemo(() => {
    const ids = new Set<string>();
    for (const part of props.parts) {
      if (part.type === 'toolCallResponseJson' || part.type === 'toolCallErr') {
        ids.add(part.id);
      }
    }
    return ids;
  });

  const isCompleteSelector = createSelector(
    completedToolIds,
    (id: string, completed) => completed.has(id)
  );

  const responseById = createMemo(() => {
    const responseMap = new Map<
      string,
      Extract<AssistantMessagePart, { type: 'toolCallResponseJson' }>
    >();

    for (const part of props.parts) {
      if (part.type === 'toolCallResponseJson') {
        responseMap.set(part.id, part);
      }
    }

    return responseMap;
  });

  const parts = createMemo(() => {
    return props.parts.filter(
      (part) =>
        part.type !== 'toolCallResponseJson' && part.type !== 'toolCallErr'
    );
  });

  const isThinkingDone = createMemo(() => {
    if (!props.isStreaming) return true;
    const p = parts();
    return p.some((part) => part.type !== 'thinking');
  });

  const keyedParts = createMemo(() => {
    const counts = new Map<AssistantMessagePart['type'], number>();
    const partsByKey = new Map<string, AssistantMessagePart>();
    const orderedKeys: string[] = [];

    for (const part of parts()) {
      const key = getAssistantPartKey(part, counts);
      orderedKeys.push(key);
      partsByKey.set(key, part);
    }

    return { orderedKeys, partsByKey };
  });

  const groupedParts = createMemo(() => {
    const itemByKey = new Map<string, RenderItem>();
    const orderedKeys: string[] = [];
    let pendingToolEntries: ToolGroupEntry[] = [];

    const flushToolGroup = () => {
      if (pendingToolEntries.length === 0) return;
      const key = `toolGroup:${pendingToolEntries[0].key}`;
      orderedKeys.push(key);
      itemByKey.set(key, {
        type: 'toolGroup',
        key,
        entries: pendingToolEntries,
      });
      pendingToolEntries = [];
    };

    keyedParts().orderedKeys.forEach((key, index) => {
      const part = keyedParts().partsByKey.get(key);
      if (!part) return;

      if (part.type === 'toolCall' || part.type === 'mcpToolCall') {
        pendingToolEntries.push({ key, part, index });
        return;
      }

      flushToolGroup();
      orderedKeys.push(key);
      itemByKey.set(key, {
        type: 'part',
        key,
        part,
        index,
      });
    });

    flushToolGroup();
    return { orderedKeys, itemByKey };
  });

  const stableRenderItems = mapArray(
    () => groupedParts().orderedKeys,
    (key) => {
      const item = createMemo(() => groupedParts().itemByKey.get(key));
      return <RenderItemView item={item} />;
    }
  );

  function ToolEntry(props: { entry: Accessor<ToolGroupEntry> }) {
    const toolPart = () => props.entry().part;

    return (
      <Switch>
        <Match when={toolPart().type === 'toolCall'}>
          {(() => {
            const part = () =>
              toolPart() as Extract<AssistantMessagePart, { type: 'toolCall' }>;

            return (
              <RenderTool
                tool_id={part().id}
                chat_id={chat.chatId()}
                json={part().json}
                name={part().name}
                response={responseById().get(part().id)}
                message_id={outer.message.id}
                part_index={props.entry().index}
                isComplete={isCompleteSelector(part().id)}
                renderContext={{
                  renderContext: {
                    isStreaming: outer.isStreaming,
                    grouped: true,
                  },
                }}
              />
            );
          })()}
        </Match>
        <Match when={toolPart().type === 'mcpToolCall'}>
          {(() => {
            const part = () =>
              toolPart() as Extract<
                AssistantMessagePart,
                { type: 'mcpToolCall' }
              >;

            return (
              <McpToolCall
                name={part().name}
                service={part().service}
                display_name={part().display_name ?? undefined}
                isComplete={isCompleteSelector(part().id)}
                renderContext={{
                  renderContext: {
                    isStreaming: outer.isStreaming,
                    grouped: true,
                  },
                }}
              />
            );
          })()}
        </Match>
      </Switch>
    );
  }

  function ToolGroupView(props: {
    item: Accessor<Extract<RenderItem, { type: 'toolGroup' }>>;
  }) {
    const entriesByKey = createMemo(() => {
      const map = new Map<string, ToolGroupEntry>();
      for (const entry of props.item().entries) {
        map.set(entry.key, entry);
      }
      return map;
    });

    const entries = mapArray(
      () => props.item().entries.map((entry) => entry.key),
      (key) => {
        const entry = createMemo(() => entriesByKey().get(key)!);
        return <ToolEntry entry={entry} />;
      }
    );

    return <Tool.Group>{entries()}</Tool.Group>;
  }

  function PartView(props: {
    item: Accessor<Extract<RenderItem, { type: 'part' }>>;
  }) {
    const part = () => props.item().part;

    return (
      <Switch>
        <Match when={part().type === 'text'}>
          {(() => {
            const text = () => {
              const p = part();
              return p.type === 'text' ? p.text : '';
            };
            return (
              <Show when={text().trim().length > 0}>
                <ChatMessageMarkdown
                  text={text()}
                  generating={() => outer.isStreaming}
                />
              </Show>
            );
          })()}
        </Match>
        <Match when={part().type === 'thinking'}>
          {(() => {
            const thinking = () => {
              const p = part();
              return p.type === 'thinking' ? p.thinking : '';
            };
            return (
              <Show when={thinking().trim().length > 0}>
                <ThinkingBlock
                  thinking={thinking()}
                  isStreaming={!isThinkingDone()}
                />
              </Show>
            );
          })()}
        </Match>
      </Switch>
    );
  }

  function RenderItemView(props: { item: Accessor<RenderItem | undefined> }) {
    const type = () => props.item()?.type;

    return (
      <Switch>
        <Match when={type() === 'toolGroup'}>
          <ToolGroupView
            item={
              props.item as Accessor<Extract<RenderItem, { type: 'toolGroup' }>>
            }
          />
        </Match>
        <Match when={type() === 'part'}>
          <PartView
            item={props.item as Accessor<Extract<RenderItem, { type: 'part' }>>}
          />
        </Match>
      </Switch>
    );
  }

  return <div class="flex flex-col gap-1">{stableRenderItems()}</div>;
}

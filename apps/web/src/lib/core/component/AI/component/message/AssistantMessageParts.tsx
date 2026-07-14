import { AssistantActivityGroup } from '@core/component/AI/component/message/AssistantActivityGroup';
import { ChatMessageMarkdown } from '@core/component/AI/component/message/ChatMessageMarkdown';
import { ThinkingBlock } from '@core/component/AI/component/message/ThinkingBlock';
import { RenderTool } from '@core/component/AI/component/tool/handler';
import { McpToolCall } from '@core/component/AI/component/tool/McpToolCall';
import { useChatContext } from '@core/component/AI/context';
import type { AssistantMessagePart } from '@service-cognition/generated/schemas/assistantMessagePart';
import type { ChatMessageWithAttachments } from '@service-cognition/generated/schemas/chatMessageWithAttachments';
import {
  type Accessor,
  createEffect,
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

type ActivityGroupEntry = {
  key: string;
  part: Extract<
    AssistantMessagePart,
    { type: 'thinking' | 'toolCall' | 'mcpToolCall' }
  >;
  index: number;
};

type RenderItem =
  | {
      type: 'activityGroup';
      key: string;
      entries: ActivityGroupEntry[];
    }
  | {
      type: 'part';
      key: string;
      part: AssistantMessagePart;
      index: number;
    }
  | {
      type: 'standaloneTool';
      key: string;
      part: Extract<AssistantMessagePart, { type: 'toolCall' }>;
      index: number;
    };

/**
 * Tools rendered outside the standard grouped activity chrome own their full
 * presentation. The dashboard renders as a full-bleed view, not a tool row.
 */
const STANDALONE_TOOLS: ReadonlySet<string> = new Set(['DisplayResults']);

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
        part.type !== 'toolCallResponseJson' &&
        part.type !== 'toolCallErr' &&
        (part.type !== 'thinking' || part.thinking.trim().length > 0)
    );
  });
  const streamingTailTextIndex = createMemo(() => {
    if (!props.isStreaming) return;
    const visibleParts = parts();
    const index = visibleParts.length - 1;
    const tail = visibleParts[index];
    if (tail?.type !== 'text' || tail.text.trim().length === 0) return;
    return index;
  });

  createEffect(() => {
    if (!props.isStreaming || streamingTailTextIndex() === undefined) {
      chat.setStreamTailState(undefined);
    }
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
    let pendingActivityEntries: ActivityGroupEntry[] = [];

    const flushActivityGroup = () => {
      if (pendingActivityEntries.length === 0) return;
      const key = `activityGroup:${pendingActivityEntries[0].key}`;
      orderedKeys.push(key);
      itemByKey.set(key, {
        type: 'activityGroup',
        key,
        entries: pendingActivityEntries,
      });
      pendingActivityEntries = [];
    };

    keyedParts().orderedKeys.forEach((key, index) => {
      const part = keyedParts().partsByKey.get(key);
      if (!part) return;

      // Standalone tools (e.g. the dashboard) break out of the tool group and
      // render full-bleed on their own.
      if (part.type === 'toolCall' && STANDALONE_TOOLS.has(part.name)) {
        flushActivityGroup();
        orderedKeys.push(key);
        itemByKey.set(key, {
          type: 'standaloneTool',
          key,
          part,
          index,
        });
        return;
      }

      if (
        part.type === 'thinking' ||
        part.type === 'toolCall' ||
        part.type === 'mcpToolCall'
      ) {
        pendingActivityEntries.push({ key, part, index });
        return;
      }

      flushActivityGroup();
      orderedKeys.push(key);
      itemByKey.set(key, {
        type: 'part',
        key,
        part,
        index,
      });
    });

    flushActivityGroup();
    return { orderedKeys, itemByKey };
  });

  const stableRenderItems = mapArray(
    () => groupedParts().orderedKeys,
    (key) => {
      const item = createMemo(() => groupedParts().itemByKey.get(key));
      return <RenderItemView item={item} />;
    }
  );

  function ActivityEntry(props: {
    entry: Accessor<ActivityGroupEntry>;
    grouped: Accessor<boolean>;
  }) {
    const activityPart = () => props.entry().part;

    return (
      <Switch>
        <Match when={activityPart().type === 'thinking'}>
          {(() => {
            const thinking = () => {
              const part = activityPart();
              return part.type === 'thinking' ? part.thinking : '';
            };

            return (
              <Show when={thinking().trim().length > 0}>
                <div classList={{ 'px-3': props.grouped() }}>
                  <ThinkingBlock
                    thinking={thinking()}
                    isStreaming={
                      outer.isStreaming &&
                      props.entry().index === parts().length - 1
                    }
                  />
                </div>
              </Show>
            );
          })()}
        </Match>
        <Match when={activityPart().type === 'toolCall'}>
          {(() => {
            const part = () =>
              activityPart() as Extract<
                AssistantMessagePart,
                { type: 'toolCall' }
              >;

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
                    grouped: props.grouped(),
                  },
                }}
              />
            );
          })()}
        </Match>
        <Match when={activityPart().type === 'mcpToolCall'}>
          {(() => {
            const part = () =>
              activityPart() as Extract<
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
                    grouped: props.grouped(),
                  },
                }}
              />
            );
          })()}
        </Match>
      </Switch>
    );
  }

  function ActivityGroupView(props: {
    item: Accessor<Extract<RenderItem, { type: 'activityGroup' }>>;
  }) {
    const entriesByKey = createMemo(() => {
      const map = new Map<string, ActivityGroupEntry>();
      for (const entry of props.item().entries) {
        map.set(entry.key, entry);
      }
      return map;
    });
    const isGrouped = () => props.item().entries.length > 1;

    const entries = mapArray(
      () => props.item().entries.map((entry) => entry.key),
      (key) => {
        const entry = createMemo(() => entriesByKey().get(key)!);
        return <ActivityEntry entry={entry} grouped={isGrouped} />;
      }
    );

    const isLatestStreamingGroup = createMemo(() => {
      if (!outer.isStreaming) return false;
      return groupedParts().orderedKeys.at(-1) === props.item().key;
    });
    const preview = createMemo(() => {
      if (!isLatestStreamingGroup()) return;
      const part = props.item().entries.at(-1)?.part;
      if (!part) return;
      if (part.type === 'thinking') {
        const normalized = part.thinking.replace(/\s+/g, ' ').trim();
        return normalized.slice(-160);
      }
      if (part.type === 'mcpToolCall') {
        return part.display_name ?? `${part.service} / ${part.name}`;
      }
      return part.name;
    });

    return (
      <AssistantActivityGroup
        itemCount={props.item().entries.length}
        preview={preview()}
      >
        {entries()}
      </AssistantActivityGroup>
    );
  }

  /** Renders a standalone tool (e.g. the dashboard) with no group chrome. */
  function StandaloneToolView(props: {
    item: Accessor<Extract<RenderItem, { type: 'standaloneTool' }>>;
  }) {
    const part = () => props.item().part;
    return (
      <RenderTool
        tool_id={part().id}
        chat_id={chat.chatId()}
        json={part().json}
        name={part().name}
        response={responseById().get(part().id)}
        message_id={outer.message.id}
        part_index={props.item().index}
        isComplete={isCompleteSelector(part().id)}
        renderContext={{
          renderContext: {
            isStreaming: outer.isStreaming,
            grouped: false,
          },
        }}
      />
    );
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
                  setStateRef={
                    outer.isStreaming &&
                    props.item().index === streamingTailTextIndex()
                      ? chat.setStreamTailState
                      : undefined
                  }
                  stateRefKey={`${outer.message.id}:${props.item().key}`}
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
        <Match when={type() === 'activityGroup'}>
          <ActivityGroupView
            item={
              props.item as Accessor<
                Extract<RenderItem, { type: 'activityGroup' }>
              >
            }
          />
        </Match>
        <Match when={type() === 'part'}>
          <PartView
            item={props.item as Accessor<Extract<RenderItem, { type: 'part' }>>}
          />
        </Match>
        <Match when={type() === 'standaloneTool'}>
          <StandaloneToolView
            item={
              props.item as Accessor<
                Extract<RenderItem, { type: 'standaloneTool' }>
              >
            }
          />
        </Match>
      </Switch>
    );
  }

  return <div class="flex flex-col gap-1">{stableRenderItems()}</div>;
}

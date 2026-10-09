import { Popover } from '@kobalte/core/popover';
import type { AgentContextDecoratorProps } from '@macro-inc/lexical-core';
import Eye from '@phosphor/eye.svg';
import { type Component, createMemo, createSignal, For, Show } from 'solid-js';
import { AgentContextElement } from './AgentContextElement';
import { parseContext, summaryOf } from './agent-context-tree';

/** A small eye in the message's corner, opening what the agent was given. */
export const AgentContext: Component<AgentContextDecoratorProps> = (props) => {
  const [raw, setRaw] = createSignal(false);
  const elements = createMemo(() => parseContext(props.text));
  const label = () => {
    const parsed = elements();
    return parsed ? summaryOf(parsed) : 'Context';
  };

  return (
    // Zero height so the message keeps its own spacing: the next block is
    // styled as the first one, and the eye sits in the corner over it.
    <div class="relative h-0 [&+*]:!mt-1.5">
      <Popover placement="bottom-end" gutter={4}>
        <Popover.Trigger
          aria-label={`What the agent saw: ${label()}`}
          title={label()}
          class="absolute -top-3 -right-3 rounded p-0.5 text-ink-extra-muted hover:bg-hover hover:text-ink"
        >
          <Eye class="size-3.5" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content class="z-action-menu flex max-h-[60vh] w-[28rem] max-w-[90vw] flex-col gap-2 overflow-auto rounded-xl border border-edge-muted bg-menu p-3 text-xs text-ink-muted shadow-lg">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium text-ink">
                Context shared with the agent
              </span>
              <button
                type="button"
                onClick={() => setRaw(!raw())}
                class="text-[11px] text-ink-extra-muted hover:text-ink"
              >
                {raw() ? 'Structured' : 'Raw'}
              </button>
            </div>
            <Show
              when={!raw() && elements()}
              fallback={
                <pre class="whitespace-pre-wrap font-mono text-[11px]">
                  {props.text}
                </pre>
              }
            >
              {(parsed) => (
                <div class="flex flex-col gap-3">
                  <For each={parsed()}>
                    {(element) => <AgentContextElement element={element} />}
                  </For>
                </div>
              )}
            </Show>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </div>
  );
};

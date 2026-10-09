import { type Component, For, Show } from 'solid-js';
import { type ContextElement, displayValue } from './agent-context-tree';

/** An attribute that names the agent itself, such as `mentioned_you`. */
function isAboutTheAgent(name: string, value: string): boolean {
  return value === 'true' && name.endsWith('_you');
}

/** One element of the context: its tag, its attributes, its text, and what it holds. */
export const AgentContextElement: Component<{ element: ContextElement }> = (
  props
) => (
  <div class="flex min-w-0 flex-col gap-1">
    <div class="flex flex-wrap items-baseline gap-1">
      <span class="font-mono text-[11px] text-ink-extra-muted">
        {props.element.tag}
      </span>
      <For each={props.element.attributes}>
        {([name, value]) => (
          <span
            class="rounded px-1.5 py-px text-[11px]"
            classList={{
              'bg-accent/10 text-accent': isAboutTheAgent(name, value),
              'bg-hover text-ink-muted': !isAboutTheAgent(name, value),
            }}
          >
            <span class="opacity-70">{name.replaceAll('_', ' ')}</span>{' '}
            {displayValue(name, value)}
          </span>
        )}
      </For>
    </div>
    <For each={props.element.notes}>
      {(note) => <p class="text-xs italic text-ink-extra-muted">{note}</p>}
    </For>
    <Show when={props.element.text}>
      {(text) => <p class="whitespace-pre-wrap text-sm text-ink">{text()}</p>}
    </Show>
    <Show when={props.element.children.length > 0}>
      <div class="flex flex-col gap-2 border-l border-edge-muted pl-3">
        <For each={props.element.children}>
          {(child) => <AgentContextElement element={child} />}
        </For>
      </div>
    </Show>
  </div>
);

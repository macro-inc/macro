import type { UserInsightRecord } from '@service-insight/generated/schemas/userInsightRecord';
import { For, Show } from 'solid-js';
import { SmartInsight } from './SmartInsights';

export type MemoryListProps = {
  memories: UserInsightRecord[];
  total: number;
  editable: boolean;
  class?: string;
};

export function MemoryList(props: MemoryListProps) {
  return (
    <div
      class={`overflow-y-scroll w-full flex flex-col border border-ink/10 p-1 rounded-md ${props.class ?? ''}`}
    >
      <div class="divide-y divide-black/10">
        <Show when={props.memories.length > 0}>
          <For each={props.memories} fallback={<div />}>
            {(memory) => {
              if (!memory.generated) {
                // return <UserMemory memory={memory} />;
              } else {
                return <SmartInsight insight={memory} />;
              }
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}

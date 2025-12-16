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
      class={`w-full flex flex-col ${props.class ?? ''}`}
    >
      <div>
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

import { cn } from '@ui';
import { Show } from 'solid-js';
import { Cut } from './cut';

/** A group of rows' heading: the topic's name and, when there is one, why it matters now. */
export function TopicHeading(props: {
  id: string;
  name: string;
  reason?: string;
  class?: string;
}) {
  return (
    <div
      class={cn('flex min-w-0 items-baseline gap-2.5 px-4 pb-1.5', props.class)}
    >
      <h2
        id={props.id}
        class="max-w-full shrink-0 truncate text-[15px] leading-6 font-semibold"
      >
        {props.name}
      </h2>
      <Show when={props.reason}>
        {(reason) => (
          <Cut>
            <span
              class="truncate text-[13px] leading-[18px] text-ink-placeholder"
              data-topic-reason
            >
              {reason()}
            </span>
          </Cut>
        )}
      </Show>
    </div>
  );
}

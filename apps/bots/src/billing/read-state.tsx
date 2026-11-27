import { type JSX, Show } from 'solid-js';
import type { BillingReading } from './read';

export function ReadState<T>(props: {
  result: BillingReading<T>;
  messages: Record<Exclude<BillingReading<never>['status'], 'ready'>, string>;
  children: (value: () => T) => JSX.Element;
}) {
  const ready = () => {
    const result = props.result;
    return result.status === 'ready' ? result : undefined;
  };
  const message = () => {
    const result = props.result;
    if (result.status !== 'ready') return props.messages[result.status];
  };

  return (
    <Show
      when={ready()}
      fallback={
        <p class="billing-note" role="status">
          {message()}
        </p>
      }
    >
      {(result) => props.children(() => result().value)}
    </Show>
  );
}

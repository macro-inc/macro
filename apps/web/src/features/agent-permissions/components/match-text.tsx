import { Show } from 'solid-js';
import { matchRange } from '../core/model';

/** `text` with the part matching the search highlighted. */
export function MatchText(props: { text: string; query?: string }) {
  const range = () => matchRange(props.text, props.query ?? '');
  return (
    <Show when={range()} fallback={props.text}>
      {(match) => (
        <>
          {props.text.slice(0, match().start)}
          <mark class="rounded-sm bg-accent-bg text-ink">
            {props.text.slice(match().start, match().end)}
          </mark>
          {props.text.slice(match().end)}
        </>
      )}
    </Show>
  );
}

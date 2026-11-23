import { For, Show } from 'solid-js';

/**
 * A translated message with `<b>…</b>` marking emphasis, rendered as text
 * (never HTML), so translators can place the emphasis where their language
 * needs it.
 */
export function RichText(props: { message: string }) {
  const parts = () => props.message.split(/<b>(.*?)<\/b>/g);
  return (
    <For each={parts()}>
      {(part, index) => (
        <Show when={index() % 2 === 1} fallback={part}>
          <strong class="font-medium text-ink/80">{part}</strong>
        </Show>
      )}
    </For>
  );
}

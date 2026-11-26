import { Tooltip } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

/**
 * One line of text, cut where the row ends; pointing at a cut line shows all
 * of it. The child is the line itself, and it or a part of it does the
 * cutting (`truncate`).
 */
export function Cut(props: { children: JSX.Element }) {
  // The line's whole text while some of it is cut off; undefined otherwise.
  const [whole, setWhole] = createSignal<string>();

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        as="span"
        class="flex min-w-0"
        onPointerEnter={(event: PointerEvent & { currentTarget: Element }) => {
          const line = event.currentTarget.firstElementChild;
          const cut =
            !!line &&
            [line, ...line.querySelectorAll('*')].some(
              (part) => part.scrollWidth > part.clientWidth
            );
          setWhole(cut ? (line.textContent ?? undefined) : undefined);
        }}
      >
        {props.children}
      </Tooltip.Trigger>
      {/* Measured as the pointer arrives, before the tooltip's delay ends. */}
      <Show when={whole()}>
        {(text) => (
          <Tooltip.Portal>
            <Tooltip.Content>
              <span class="block max-w-80 text-left">{text()}</span>
            </Tooltip.Content>
          </Tooltip.Portal>
        )}
      </Show>
    </Tooltip.Root>
  );
}

import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/** Owns delayed scrolling and highlighting for one mounted chat transcript. */
export function createChatMessageTarget(options: {
  params: Accessor<Record<string, string> | undefined>;
  container: Accessor<HTMLElement | undefined>;
}) {
  const [activeId, setActiveId] = createSignal<string>();
  createEffect(
    on(options.params, (params) => {
      const messageId = params?.message_id;
      setActiveId(messageId);
      if (!messageId) return;

      const scrollTimer = setTimeout(() => {
        const element = Array.from(
          options.container()?.querySelectorAll<HTMLElement>('[id]') ?? []
        ).find((element) => element.id === `chat-${messageId}`);
        if (element?.closest('[data-chat-scroll]')) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 0);
      const highlightTimer = setTimeout(() => setActiveId(undefined), 1500);
      onCleanup(() => {
        clearTimeout(scrollTimer);
        clearTimeout(highlightTimer);
      });
    })
  );
  return activeId;
}

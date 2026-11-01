import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';
import { createMessageReadVisibility } from '../primitives/create-message-read-visibility';

const MessageReadVisibilityContext =
  createContext<ReturnType<typeof createMessageReadVisibility>>();

/** Thread lists supply their floating chrome insets; standalone threads use the window. */
export function MessageReadVisibilityProvider(
  props: ParentProps<{
    root?: Accessor<Element | null | undefined>;
    insets?: Accessor<{ start: number; end: number }>;
  }>
) {
  const inherited = useContext(MessageReadVisibilityContext);
  const visibility =
    !props.root && inherited
      ? inherited
      : createMessageReadVisibility({
          root: props.root ?? (() => null),
          insets: props.insets ?? (() => ({ start: 0, end: 0 })),
        });
  return (
    <MessageReadVisibilityContext.Provider value={visibility}>
      {props.children}
    </MessageReadVisibilityContext.Provider>
  );
}

export function useMessageReadVisibility(
  element: Accessor<Element | undefined>,
  batch: Accessor<string>
) {
  const visibility = useContext(MessageReadVisibilityContext);
  if (!visibility) throw new Error('MessageReadVisibilityProvider is required');
  const [visibleBatch, setVisibleBatch] = createSignal<string>();
  createEffect(
    on([element, batch], ([target, key]) => {
      // Every newly unread batch needs a fresh browser observation. A live
      // notification may arrive in the same task that scrolls the row away.
      if (target && key)
        onCleanup(
          visibility.observe(target, (visible) =>
            setVisibleBatch(visible ? key : undefined)
          )
        );
    })
  );
  return () => !!batch() && visibleBatch() === batch();
}

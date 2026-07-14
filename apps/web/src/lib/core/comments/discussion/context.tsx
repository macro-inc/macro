import { createContext, type ParentProps, useContext } from 'solid-js';
import type { DiscussionSource } from './types';

const DiscussionContext = createContext<DiscussionSource>();

/** Provides a [`DiscussionSource`] to the discussion components below it. */
export function DiscussionProvider(
  props: ParentProps<{ source: DiscussionSource }>
) {
  return (
    <DiscussionContext.Provider value={props.source}>
      {props.children}
    </DiscussionContext.Provider>
  );
}

/** Reads the current [`DiscussionSource`]. Throws outside a provider. */
export function useDiscussion(): DiscussionSource {
  const source = useContext(DiscussionContext);
  if (!source) {
    throw new Error('useDiscussion must be used within a DiscussionProvider');
  }
  return source;
}

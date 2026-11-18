import {
  type Accessor,
  createContext,
  createSignal,
  useContext,
} from 'solid-js';

/**
 * Which background drafts are on screen in New routine, so the app-wide pill
 * and toasts don't report them a second time.
 */
export type DraftsOnScreen = {
  /** Mark these drafts on screen until the returned function runs. */
  show(ids: Accessor<readonly string[]>): () => void;
  isShown(id: string): boolean;
  /** The person saw this finished draft; it needs no toast. */
  markSeen(id: string): void;
  wasSeen(id: string): boolean;
};

export const DraftsOnScreenContext = createContext<DraftsOnScreen>();

export function createDraftsOnScreen(): DraftsOnScreen {
  const [sources, setSources] = createSignal<
    readonly Accessor<readonly string[]>[]
  >([]);
  const [seen, setSeen] = createSignal<readonly string[]>([]);
  return {
    show(ids) {
      setSources((list) => [...list, ids]);
      return () => setSources((list) => list.filter((each) => each !== ids));
    },
    isShown: (id) => sources().some((ids) => ids().includes(id)),
    markSeen(id) {
      if (!seen().includes(id)) setSeen((list) => [...list, id]);
    },
    wasSeen: (id) => seen().includes(id),
  };
}

/** The drafts on screen; New routine with background drafts requires them. */
export function useDraftsOnScreen(): DraftsOnScreen {
  const drafts = useContext(DraftsOnScreenContext);
  if (!drafts) {
    throw new Error(
      'Background routine drafts need a DraftsOnScreenContext provider'
    );
  }
  return drafts;
}

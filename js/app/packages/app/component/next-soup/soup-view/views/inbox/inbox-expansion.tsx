import { createContext, createSignal, type FlowComponent, useContext } from 'solid-js';

type InboxExpansion = {
  isExpanded: (entityId: string) => boolean;
  toggle: (entityId: string) => void;
};

const InboxExpansionContext = createContext<InboxExpansion>();

/**
 * View-level expand/collapse state for inbox rows (which thread rows have their
 * reply sub-items open). Owned above the virtualizer so it survives rows
 * unmounting as they scroll out of view — the card's own local state can't,
 * since virtua remounts offscreen rows.
 */
export const InboxExpansionProvider: FlowComponent = (props) => {
  // Set behind a signal with `equals: false` so mutating it in place still
  // notifies the rows that read `isExpanded`.
  const [expanded, setExpanded] = createSignal(new Set<string>(), {
    equals: false,
  });

  const value: InboxExpansion = {
    isExpanded: (entityId) => expanded().has(entityId),
    toggle: (entityId) =>
      setExpanded((set) => {
        if (set.has(entityId)) set.delete(entityId);
        else set.add(entityId);
        return set;
      }),
  };

  return (
    <InboxExpansionContext.Provider value={value}>
      {props.children}
    </InboxExpansionContext.Provider>
  );
};

export const useInboxExpansion = () => useContext(InboxExpansionContext);

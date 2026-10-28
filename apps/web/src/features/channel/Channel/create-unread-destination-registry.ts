export type UnreadDestinationElements = {
  messages: ReadonlyMap<string, HTMLElement>;
  disclosures: ReadonlyMap<string, HTMLElement>;
};

/** Mounted destinations are explicit; ThreadList owns when layout is measured. */
export function createUnreadDestinationRegistry(onChange: () => void) {
  const messages = new Map<string, HTMLElement>();
  const disclosures = new Map<string, HTMLElement>();
  const register =
    (elements: Map<string, HTMLElement>) =>
    (id: string, element: HTMLElement) => {
      elements.set(id, element);
      onChange();
      return () => {
        // A replacement may mount before the previous row's cleanup runs.
        if (elements.get(id) !== element) return;
        elements.delete(id);
        onChange();
      };
    };

  return {
    elements: { messages, disclosures } satisfies UnreadDestinationElements,
    registerMessage: register(messages),
    registerDisclosure: register(disclosures),
  };
}

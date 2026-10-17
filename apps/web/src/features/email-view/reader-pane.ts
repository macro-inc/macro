import { type Accessor, createContext, useContext } from 'solid-js';

/**
 * Present while threads open in a reading pane beside the list instead of
 * replacing it. The list keeps its own keys; the reader's live in a child
 * scope so the two never replace each other's registrations.
 */
export type EmailReaderPane = {
  /** The reader's hotkey scope, a child of the split's. */
  hotkeyScope: string;
  /** Hands the keyboard back to the list without closing the thread. */
  focusList: () => void;
  /** The thread that should take focus once it is on screen. */
  focusRequest: Accessor<string | undefined>;
  requestFocus: (threadId: string) => void;
  clearFocusRequest: () => void;
};

export const EmailReaderPaneContext = createContext<EmailReaderPane>();

export const useEmailReaderPane = () => useContext(EmailReaderPaneContext);

/** Hooks the list uses while threads open in the reading pane beside it. */
export type EmailListPane = {
  /** Moves the keyboard into the reader once this thread is on screen. */
  focusReader: (threadId: string) => void;
};

import { useHistoryMetaQuery } from '@queries/history';
import type { HistorySession } from '@service-sync/client';
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  type Setter,
  useContext,
} from 'solid-js';

type HistoryContextValue = {
  /** Whether history mode is active. */
  isViewingHistory: Accessor<boolean>;
  /** Sets history mode directly. */
  setViewingHistory: Setter<boolean>;
  /** Selected history cursor time. Null means current state. */
  selectedAt: Accessor<Date | null>;
  /** Sets the selected cursor time. */
  setSelectedAt: Setter<Date | null>;
  /** Whether the cursor is at current state. */
  isScrubbedRightmost: Accessor<boolean>;
  /** Sets current-state cursor mode. */
  setIsScrubbedRightmost: Setter<boolean>;
  /** Enters history mode at a timestamp. */
  enterAt: (at: Date | null) => void;
  /** Enters history mode at current state. */
  enterRightmost: () => void;
  /** Leaves history mode. */
  exit: () => void;
  /** Per-user edit sessions for this document. */
  sessions: Accessor<readonly HistorySession[]>;
  /** Whether sessions are loading. */
  isLoadingSessions: Accessor<boolean>;
};

const HistoryContext = createContext<HistoryContextValue>();

export function HistoryProvider(props: {
  documentId: Accessor<string>;
  children: JSX.Element;
}) {
  const [isViewingHistory, setViewingHistory] = createSignal(false);
  const [selectedAt, setSelectedAt] = createSignal<Date | null>(null);
  const [isScrubbedRightmost, setIsScrubbedRightmost] = createSignal(true);
  const history = useHistoryMetaQuery(props.documentId);

  const enterAt = (at: Date | null) => {
    setSelectedAt(at);
    setIsScrubbedRightmost(at === null);
    setViewingHistory(true);
  };

  const enterRightmost = () => {
    setSelectedAt(null);
    setIsScrubbedRightmost(true);
    setViewingHistory(true);
  };

  const exit = () => {
    setViewingHistory(false);
    setSelectedAt(null);
    setIsScrubbedRightmost(true);
  };

  const value: HistoryContextValue = {
    isViewingHistory,
    setViewingHistory,
    selectedAt,
    setSelectedAt,
    isScrubbedRightmost,
    setIsScrubbedRightmost,
    enterAt,
    enterRightmost,
    exit,
    sessions: () => history.data?.sessions ?? [],
    isLoadingSessions: () => history.isLoading,
  };

  return (
    <HistoryContext.Provider value={value}>
      {props.children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const context = useContext(HistoryContext);
  if (!context)
    throw new Error('useHistory must be used inside HistoryProvider');
  return context;
}

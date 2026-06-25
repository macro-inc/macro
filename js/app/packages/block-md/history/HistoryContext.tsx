import { useHistoryMetaQuery } from '@queries/history';
import {
  useCreatePinMutation,
  useDeletePinMutation,
  usePinsQuery,
} from '@queries/pins';
import type { HistorySession, VersionPin } from '@service-sync/client';
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
  /** Saved version pins for this document. */
  pins: Accessor<readonly VersionPin[]>;
  /** Creates a version pin. */
  createPin: (atMs: number, label: string) => void;
  /** Deletes a version pin. */
  deletePin: (pinId: string) => void;
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
  const pins = usePinsQuery(props.documentId);
  const createPin = useCreatePinMutation(props.documentId);
  const deletePin = useDeletePinMutation(props.documentId);

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
    pins: () => pins.data ?? [],
    createPin: (atMs, label) => createPin.mutate({ atMs, label }),
    deletePin: (pinId) => deletePin.mutate(pinId),
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

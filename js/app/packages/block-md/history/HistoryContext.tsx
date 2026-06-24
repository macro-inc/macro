import {
  useCreatePinMutation,
  useDeletePinMutation,
  usePinsQuery,
} from '@queries/pins';
import {
  type HistorySession,
  syncServiceClient,
  type VersionPin,
} from '@service-sync/client';
import {
  type Accessor,
  createContext,
  createResource,
  createSignal,
  type JSX,
  type Setter,
  useContext,
} from 'solid-js';

async function fetchHistoryMeta(
  documentId: string
): Promise<{ sessions: HistorySession[] } | undefined> {
  const maybe = await syncServiceClient.getHistoryMeta({ documentId });
  if (maybe.isErr()) {
    console.error("Couldn't get history meta", maybe.error);
    return undefined;
  }
  return { sessions: maybe.value.sessions };
}

type HistoryContextValue = {
  isViewingHistory: Accessor<boolean>;
  setViewingHistory: Setter<boolean>;
  selectedAt: Accessor<Date | null>;
  setSelectedAt: Setter<Date | null>;
  isScrubbedRightmost: Accessor<boolean>;
  setIsScrubbedRightmost: Setter<boolean>;
  enterAt: (at: Date | null) => void;
  enterRightmost: () => void;
  exit: () => void;
  sessions: Accessor<readonly HistorySession[]>;
  isLoadingSessions: Accessor<boolean>;
  pins: Accessor<readonly VersionPin[]>;
  createPin: (atMs: number, label: string) => void;
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
  const [history] = createResource(props.documentId, fetchHistoryMeta);
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
    sessions: () => history()?.sessions ?? [],
    isLoadingSessions: () => history.loading,
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

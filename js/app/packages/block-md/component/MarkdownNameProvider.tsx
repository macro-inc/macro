import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  type FlowComponent,
  useContext,
} from 'solid-js';

type MarkdownNameContextValue = {
  persistedName: Accessor<string | undefined>;
  editorName: Accessor<string | undefined>;
  displayName: Accessor<string | undefined>;
  setOptimisticName: (name: string | undefined) => void;
};

const MarkdownNameContext = createContext<MarkdownNameContextValue>();

export const MarkdownNameProvider: FlowComponent = (props) => {
  // Keep the editable title and the label separate. An empty persisted
  // title is a real editor value so TitleEditor can stay empty and show its
  // placeholder, but surrounding UI should still display the block fallback
  // such as "New Note" or "New Task".
  const persistedName = useBlockDocumentName('');
  const fallbackName = useBlockDocumentName();
  const [optimisticName, setOptimisticName] = createSignal<
    string | undefined
  >();
  const editorName = createMemo(() => optimisticName() ?? persistedName());
  const displayName = createMemo(() => {
    const optimistic = optimisticName();
    if (optimistic !== undefined) return optimistic || fallbackName();
    return persistedName() || fallbackName();
  });

  return (
    <MarkdownNameContext.Provider
      value={{ persistedName, editorName, displayName, setOptimisticName }}
    >
      {props.children}
    </MarkdownNameContext.Provider>
  );
};

export function useMarkdownName() {
  const context = useContext(MarkdownNameContext);
  if (!context) {
    const persistedName = useBlockDocumentName('');
    const fallbackName = useBlockDocumentName();
    const displayName = () => persistedName() || fallbackName();
    return {
      persistedName,
      editorName: persistedName,
      displayName,
      setOptimisticName: () => {},
    };
  }

  return context;
}

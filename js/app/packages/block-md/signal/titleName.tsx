import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  type FlowComponent,
  useContext,
} from 'solid-js';

type MarkdownTitleNameContextValue = {
  persistedName: Accessor<string | undefined>;
  editorName: Accessor<string | undefined>;
  displayName: Accessor<string | undefined>;
  setOptimisticName: (name: string | undefined) => void;
};

const MarkdownTitleNameContext = createContext<MarkdownTitleNameContextValue>();

export const MarkdownTitleNameProvider: FlowComponent = (props) => {
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
    <MarkdownTitleNameContext.Provider
      value={{ persistedName, editorName, displayName, setOptimisticName }}
    >
      {props.children}
    </MarkdownTitleNameContext.Provider>
  );
};

export function useMarkdownTitleName() {
  const context = useContext(MarkdownTitleNameContext);
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

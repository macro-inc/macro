import {
  type Accessor,
  createContext,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  type ParentComponent,
  Suspense,
  useContext,
} from 'solid-js';

const SuspenseContext = createContext<{
  isPending: Accessor<boolean>;
}>();

export const useSuspenseContext = () => {
  const context = useContext(SuspenseContext);
  if (!context) {
    throw new Error(
      `SuspenseContext is not found. Make sure you're calling it within a SuspenseContextProvider.`
    );
  }

  return context;
};

const [isPending, setIsPending] = createSignal(false);

export const SuspenseContextComp: ParentComponent<{
  id?: string;
  fallback?: JSX.Element;
}> = (props) => {
  const _id = props.id ?? createUniqueId(); // for debugging
  const Fallback: ParentComponent = () => {
    setIsPending(true);
    onCleanup(() => {
      setTimeout(() => {
        setIsPending(false);
      });
    });
    return <>{props.fallback}</>;
  };

  return (
    <SuspenseContext.Provider value={{ isPending }}>
      <Suspense fallback={<Fallback />}>{props.children}</Suspense>
    </SuspenseContext.Provider>
  );
};

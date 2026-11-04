import { createContext, type JSX, useContext } from 'solid-js';
import type { ConnectorImportContext } from './contracts';

const Context = createContext<ConnectorImportContext>();

export function ConnectorImportProvider(props: {
  context: ConnectorImportContext;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function useConnectorImport(): ConnectorImportContext {
  const context = useContext(Context);
  if (!context) throw new Error('ConnectorImportProvider is required');
  return context;
}

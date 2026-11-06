import { createContext, type JSX, useContext } from 'solid-js';
import type { ImportJobsContext } from './contracts';

const Context = createContext<ImportJobsContext>();

export function ImportJobsProvider(props: {
  context: ImportJobsContext;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function useImportJobs(): ImportJobsContext {
  const context = useContext(Context);
  if (!context) throw new Error('ImportJobsProvider is required');
  return context;
}

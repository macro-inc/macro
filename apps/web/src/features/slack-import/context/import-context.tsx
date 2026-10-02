import { createContext, type JSX, useContext } from 'solid-js';
import type {
  ArchiveSource,
  ImportCommands,
  ImportSource,
  ImportSourceInputs,
} from './contracts';

export type ImportContext = {
  createSource(inputs: ImportSourceInputs): {
    source: ImportSource;
    commands: ImportCommands;
  };
  createArchive(): ArchiveSource;
  protectFile(): () => void;
  newToken(): string;
};

const Context = createContext<ImportContext>();

export function ImportProvider(props: {
  context: ImportContext;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function useImportContext(): ImportContext {
  const context = useContext(Context);
  if (!context) throw new Error('ImportProvider is required');
  return context;
}

/**
 * What the viewer needs from the app, injected by the block so the viewer
 * itself has no app dependencies.
 */

import type { FigEngine } from '@core/fig-engine/client';
import { createContext, type JSX, useContext } from 'solid-js';

export interface FigViewerContext {
  engine: FigEngine;
  fileName: () => string;
  download: (blob: Blob, name: string) => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  /** Whether the person may edit the file. */
  canEdit?: () => boolean;
  /** Stores the edited `.fig` as a new version. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Identifies the file on the clipboard (the document id). */
  fileKey?: string;
}

const Context = createContext<FigViewerContext>();

export function FigViewerProvider(props: {
  context: FigViewerContext;
  children: JSX.Element;
}) {
  return (
    <Context.Provider value={props.context}>{props.children}</Context.Provider>
  );
}

export function useFigViewerContext(): FigViewerContext {
  const context = useContext(Context);
  if (!context) throw new Error('FigViewerProvider is missing');
  return context;
}

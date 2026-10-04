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

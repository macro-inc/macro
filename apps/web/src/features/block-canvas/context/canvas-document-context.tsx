import type { PortalScope } from '@core/component/ScopedPortal';
import type { Accessor, FlowComponent, Owner } from 'solid-js';
import { createContext, getOwner, useContext } from 'solid-js';
import {
  type CanvasDocumentState,
  createCanvasDocumentState,
} from './canvas-document-state';

export type CanvasView = {
  x: number;
  y: number;
  scale: number;
};

export type CanvasDocumentContextValue = {
  documentId: Accessor<string>;
  canEdit: Accessor<boolean>;
  isNested: Accessor<boolean>;
  hotkeyScope: Accessor<string>;
  portalScope: Accessor<PortalScope>;
  onLocationChange: Accessor<((location: CanvasView) => void) | undefined>;
  state: CanvasDocumentState;
  instanceOwner?: Owner;
};

export type CanvasDocumentProviderProps = {
  documentId: string;
  canEdit: boolean;
  isNested?: boolean;
  hotkeyScope: string;
  portalScope?: PortalScope;
  onLocationChange?: (location: CanvasView) => void;
};

const CanvasDocumentContext = createContext<CanvasDocumentContextValue>();

const CanvasDocumentOwner: FlowComponent = (props) => {
  const context = useContext(CanvasDocumentContext);
  if (!context) throw new Error('CanvasDocumentOwner requires its provider');
  context.instanceOwner = getOwner() ?? undefined;
  return props.children;
};

export const CanvasDocumentProvider: FlowComponent<
  CanvasDocumentProviderProps
> = (props) => {
  const context: CanvasDocumentContextValue = {
    documentId: () => props.documentId,
    canEdit: () => props.canEdit,
    isNested: () => props.isNested ?? false,
    hotkeyScope: () => props.hotkeyScope,
    portalScope: () => props.portalScope ?? 'split',
    onLocationChange: () => props.onLocationChange,
    state: createCanvasDocumentState(),
  };

  return (
    <CanvasDocumentContext.Provider value={context}>
      <CanvasDocumentOwner>{props.children}</CanvasDocumentOwner>
    </CanvasDocumentContext.Provider>
  );
};

export function useCanvasDocument(): CanvasDocumentContextValue {
  const context = useContext(CanvasDocumentContext);
  if (!context) {
    throw new Error(
      'useCanvasDocument must be used within a CanvasDocumentProvider'
    );
  }
  return context;
}

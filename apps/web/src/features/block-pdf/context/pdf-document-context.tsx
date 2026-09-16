import type { PortalScope } from '@core/component/ScopedPortal';
import {
  type Accessor,
  createContext,
  createSignal,
  type FlowComponent,
  useContext,
} from 'solid-js';
import type { LocationSearchParams } from '../signal/location';
import {
  createPdfDocumentState,
  type PdfDocumentState,
} from './pdf-document-state';

export type PdfDocumentPermissions = {
  canComment: boolean;
  canEdit: boolean;
  isOwner: boolean;
};

export type PdfDocumentContextValue = {
  documentId: Accessor<string>;
  documentVersionId: Accessor<number | undefined>;
  documentName: Accessor<string>;
  isNested: Accessor<boolean>;
  hotkeyScope: Accessor<string>;
  portalScope: Accessor<PortalScope>;
  permissions: {
    canComment: Accessor<boolean>;
    canEdit: Accessor<boolean>;
    isOwner: Accessor<boolean>;
  };
  locationParams: Accessor<LocationSearchParams>;
  rootElement: Accessor<HTMLElement | undefined>;
  setRootElement: (element: HTMLElement | undefined) => void;
  state: PdfDocumentState;
};

export type PdfDocumentProviderProps = {
  documentId: string;
  documentVersionId?: number;
  documentName: string;
  isNested?: boolean;
  hotkeyScope: string;
  portalScope?: PortalScope;
  permissions: PdfDocumentPermissions;
  locationParams?: LocationSearchParams;
};

const PdfDocumentContext = createContext<PdfDocumentContextValue>();

export const PdfDocumentProvider: FlowComponent<PdfDocumentProviderProps> = (
  props
) => {
  const documentId = () => props.documentId;
  const [rootElement, setRootElement] = createSignal<HTMLElement>();
  const context: PdfDocumentContextValue = {
    documentId,
    documentVersionId: () => props.documentVersionId,
    documentName: () => props.documentName,
    isNested: () => props.isNested ?? false,
    hotkeyScope: () => props.hotkeyScope,
    portalScope: () => props.portalScope ?? 'split',
    permissions: {
      canComment: () => props.permissions.canComment,
      canEdit: () => props.permissions.canEdit,
      isOwner: () => props.permissions.isOwner,
    },
    locationParams: () => props.locationParams ?? {},
    rootElement,
    setRootElement,
    state: createPdfDocumentState(documentId),
  };

  return (
    <PdfDocumentContext.Provider value={context}>
      {props.children}
    </PdfDocumentContext.Provider>
  );
};

export function usePdfDocument(): PdfDocumentContextValue {
  const context = useContext(PdfDocumentContext);
  if (!context) {
    throw new Error('usePdfDocument must be used within a PdfDocumentProvider');
  }
  return context;
}

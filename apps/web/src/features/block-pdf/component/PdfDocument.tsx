import './block.css';

import type { PortalScope } from '@core/component/ScopedPortal';
import type { GetDocumentResponseDataViewLocation } from '@service-storage/generated/schemas/getDocumentResponseDataViewLocation';
import { debounce, leading } from '@solid-primitives/scheduled';
import { type BeforeLeaveEventArgs, useBeforeLeave } from '@solidjs/router';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import {
  createEffect,
  createResource,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { fromZodError } from 'zod-validation-error';
import { PdfCommentsProvider } from '../context/pdf-comments-context';
import {
  type PdfDocumentPermissions,
  PdfDocumentProvider,
  usePdfDocument,
} from '../context/pdf-document-context';
import { PdfViewerProvider, usePdfViewer } from '../context/pdf-viewer-context';
import {
  type LocationBlockParams,
  type LocationSearchParams,
  useGoToLinkLocation,
  useGoToLinkLocationFromParams,
} from '../signal/location';
import { usePdfSave } from '../signal/save';
import { useUpdateColorsEffect } from '../signal/setting';
import { usePdfCommentProjection } from '../store/comments/commentStore';
import { useSyncActivePlaceableWithCommentThread } from '../store/placeables';
import { IModificationDataOnServerSchema } from '../type/coParse';
import { preprocess } from '../websocket/preprocess';
import { Document } from './Document';

function preventNativePdfShortcuts(event: KeyboardEvent) {
  if (
    (event.key.toLowerCase() === 's' || event.key === 'z') &&
    (navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey)
  ) {
    event.preventDefault();
  }
  if (
    event.key === 'p' &&
    (navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey)
  ) {
    event.preventDefault();
  }
}

export type PdfDocumentMethods = {
  goToLocationFromParams: (params: LocationBlockParams) => Promise<void>;
};

export type PdfDocumentProps = {
  documentId: string;
  documentVersionId?: number;
  documentName: string;
  documentProxy?: PDFDocumentProxy;
  viewLocation?: GetDocumentResponseDataViewLocation;
  modificationData?: unknown;
  isNested?: boolean;
  portalScope?: PortalScope;
  permissions: PdfDocumentPermissions;
  locationParams?: LocationSearchParams;
  registerMethods?: (methods: Partial<PdfDocumentMethods>) => void;
  children: JSX.Element;
};

export function PdfDocument(props: PdfDocumentProps) {
  return (
    <Show when={props.documentId} keyed>
      {(documentId) => (
        <PdfDocumentProvider
          documentId={documentId}
          documentProxy={props.documentProxy}
          documentVersionId={props.documentVersionId}
          documentName={props.documentName}
          isNested={props.isNested}
          portalScope={props.portalScope}
          permissions={props.permissions}
          locationParams={props.locationParams}
        >
          <PdfViewerProvider>
            <PdfDocumentBehavior {...props} />
          </PdfViewerProvider>
        </PdfDocumentProvider>
      )}
    </Show>
  );
}

export function PdfDocumentContent() {
  useSyncActivePlaceableWithCommentThread();

  return (
    <div class="flex size-full relative justify-end overflow-visible">
      <Document />
    </div>
  );
}

function PdfDocumentBehavior(props: PdfDocumentProps) {
  const pdf = usePdfDocument();
  const pdfViewer = usePdfViewer();
  const comments = usePdfCommentProjection();
  const savePdf = usePdfSave();
  const [pendingLocationParams, setPendingLocationParams] =
    createSignal<LocationBlockParams>();
  const goToInitialLocation = useGoToLinkLocation();
  const goToLocationFromParams = useGoToLinkLocationFromParams();
  let imperativeNavigationQueued = false;

  props.registerMethods?.({
    goToLocationFromParams: async (params) => {
      imperativeNavigationQueued = true;
      setPendingLocationParams({ ...params });
    },
  });

  createEffect(() => {
    pdf.setPersistedViewLocation(
      pdf.isNested() ? undefined : props.viewLocation
    );

    const modificationData = props.modificationData;
    if (!modificationData) return;
    const parsed = IModificationDataOnServerSchema.safeParse(modificationData);
    if (!parsed.success) {
      console.error(
        'Failed to parse modification data',
        fromZodError(parsed.error)
      );
      return;
    }

    pdf.model.commands.hydrateFromServer(parsed.data);
  });

  createEffect(() => {
    if (imperativeNavigationQueued || !pdfViewer.root.isReady()) return;
    void goToInitialLocation(pdf.locationParams());
  });

  createEffect(() => {
    const params = pendingLocationParams();
    if (
      !params ||
      !pdfViewer.root.isReady() ||
      !pdfViewer.root.hasVisiblePages()
    ) {
      return;
    }
    setPendingLocationParams(undefined);
    pdfViewer.root.instance()?.clearAllOverlays();
    void goToLocationFromParams(params);
  });

  const [preprocessResource] = createResource(() => {
    const documentVersionId = pdf.documentVersionId();
    if (!documentVersionId) return;
    return {
      documentId: pdf.documentId(),
      documentVersionId,
    };
  }, preprocess);

  createEffect(() => {
    if (preprocessResource.error) return;
    const coparse = preprocessResource.latest;
    if (!coparse) return;

    pdf.definitions.commands.loadTermXml(coparse.defs ?? '');
    pdf.outline.commands.loadCoparse(coparse);
    pdfViewer.replaceOverlays(coparse.overlays);
  });

  const debouncedSave = leading(
    debounce,
    (event: BeforeLeaveEventArgs) => {
      event.preventDefault();
      void savePdf().then(() => event.retry(true));
    },
    500
  );
  useBeforeLeave((event) => {
    if (!pdf.isNested()) debouncedSave(event);
  });

  useUpdateColorsEffect();

  onMount(() => {
    if (pdf.isNested()) return;
    const handleBeforeUnload = (event: Event) => {
      if (pdf.persistence.isSaving()) event.preventDefault();
    };
    window.addEventListener('keydown', preventNativePdfShortcuts);
    window.addEventListener('beforeunload', handleBeforeUnload);
    onCleanup(() => {
      window.removeEventListener('keydown', preventNativePdfShortcuts);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    });
  });

  return (
    <PdfCommentsProvider comments={comments}>
      <div
        ref={pdfViewer.setRootElement}
        class="size-full select-none overscroll-none overflow-hidden flex flex-col"
        onContextMenu={(event) => event.preventDefault()}
        data-tut="App"
      >
        {props.children}
      </div>
    </PdfCommentsProvider>
  );
}

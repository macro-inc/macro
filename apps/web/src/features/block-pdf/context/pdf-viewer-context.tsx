import {
  type Accessor,
  createContext,
  createSignal,
  type ParentComponent,
  useContext,
} from 'solid-js';
import {
  createPdfViewerRuntime,
  type PdfViewerRuntime,
} from '../primitives/pdf-viewer-runtime';

export type PdfViewerContextValue = PdfViewerRuntime & {
  rootElement: Accessor<HTMLElement | undefined>;
  setRootElement: (element: HTMLElement | undefined) => void;
  pageClicksDisabled: Accessor<boolean>;
  textSelectionActive: Accessor<boolean>;
  searchNavigationPending: Accessor<boolean>;
  beginTextSelection: () => void;
  endTextSelection: () => void;
  beginSearchNavigation: () => void;
  endSearchNavigation: () => void;
  runWithPageClicksDisabled: (operation: () => void) => void;
};

const PdfViewerContext = createContext<PdfViewerContextValue>();

export const PdfViewerProvider: ParentComponent = (props) => {
  const runtime = createPdfViewerRuntime();
  const [rootElement, setRootElement] = createSignal<HTMLElement>();
  const [pageClicksDisabled, setPageClicksDisabled] = createSignal(false);
  const [textSelectionActive, setTextSelectionActive] = createSignal(false);
  const [searchNavigationPending, setSearchNavigationPending] =
    createSignal(false);

  const value: PdfViewerContextValue = {
    ...runtime,
    rootElement,
    setRootElement,
    pageClicksDisabled,
    textSelectionActive,
    searchNavigationPending,
    beginTextSelection() {
      setTextSelectionActive(true);
    },
    endTextSelection() {
      setTextSelectionActive(false);
    },
    beginSearchNavigation() {
      setSearchNavigationPending(true);
    },
    endSearchNavigation() {
      setSearchNavigationPending(false);
    },
    runWithPageClicksDisabled(operation) {
      setPageClicksDisabled(true);
      try {
        operation();
      } finally {
        setPageClicksDisabled(false);
      }
    },
  };

  return (
    <PdfViewerContext.Provider value={value}>
      {props.children}
    </PdfViewerContext.Provider>
  );
};

export function usePdfViewer(): PdfViewerContextValue {
  const context = useContext(PdfViewerContext);
  if (!context) {
    throw new Error('usePdfViewer must be used within a PdfViewerProvider');
  }
  return context;
}

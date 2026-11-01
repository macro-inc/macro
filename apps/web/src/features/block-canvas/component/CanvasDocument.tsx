import {
  type Accessor,
  createResource,
  type JSX,
  lazy,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type { CanvasFile } from '../core/document-format';
import { type CanvasLoadResult, loadCanvasFile } from '../core/load-document';
import type { CanvasView } from '../core/view';
import { importCanvasMarkdown } from '../primitives/text-lexical';
import { Loading } from './Loading';

const CanvasNextDocument = lazy(() => import('../canvas-next-document'));

export type CanvasDocumentMethods = {
  exportCanvas: () => Promise<CanvasFile>;
  goToLocationFromParams: (params: Record<string, unknown>) => void;
};

export type CanvasDocumentProps = {
  documentId: string;
  file?: Blob;
  /** Backend-owned content is loaded from sync, without an object-storage seed. */
  shared?: boolean;
  canEdit: boolean;
  isNested?: boolean;
  view?: CanvasView;
  locationParams?: Record<string, string | string[] | undefined>;
  onLocationChange?: (location: CanvasView) => void;
  registerMethods?: (methods: Partial<CanvasDocumentMethods>) => void;
  children?: (content: JSX.Element, state: CanvasDocumentChrome) => JSX.Element;
};

export type CanvasDocumentChrome = {
  savedFile: Accessor<Blob | undefined>;
  location: () => { x: number; y: number; s: number };
};

export function CanvasDocument(props: CanvasDocumentProps) {
  return (
    <Show when={props.documentId} keyed>
      {(documentId) => (
        <CanvasDocumentLoader {...props} documentId={documentId} />
      )}
    </Show>
  );
}

function CanvasDocumentLoader(props: CanvasDocumentProps) {
  const [loaded] = createResource(
    () => ({ file: props.file, shared: props.shared }),
    async ({ file, shared }): Promise<CanvasLoadResult> => {
      if (shared)
        return {
          kind: 'next',
          file: {
            version: 2,
            document: {
              rootId: 'canvas-root',
              items: { 'canvas-root': { id: 'canvas-root', type: 'surface' } },
            },
          },
        };
      if (!file) return { kind: 'error', message: 'Canvas file unavailable' };
      try {
        return loadCanvasFile(
          JSON.parse(await file.text()),
          importCanvasMarkdown
        );
      } catch {
        return { kind: 'error', message: 'Could not read canvas file' };
      }
    }
  );
  return (
    <Show when={!loaded.loading} fallback={<Loading />}>
      <Switch>
        <Match when={loaded()?.kind === 'next' && loaded()} keyed>
          {(result) =>
            result.kind === 'next' && (
              <CanvasNextDocument {...props} initial={result.file} />
            )
          }
        </Match>
        <Match when={loaded()?.kind === 'error' && loaded()} keyed>
          {(result) =>
            result.kind === 'error' && (
              <div
                role="alert"
                class="flex size-full flex-col items-center justify-center gap-3 p-6 text-sm"
              >
                <p>{result.message}</p>
              </div>
            )
          }
        </Match>
      </Switch>
    </Show>
  );
}

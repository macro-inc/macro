import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { fetchSnippetRaw } from '@queries/storage/snippets';
import { dispatchApplicationCommandIfSessionEdit } from '../../plugins/group-b/command';
import type { MenuOperations } from '../../shared/inlineMenu';
import type { SnippetMenuHost } from './snippets';

type SnippetRequest = {
  key: number;
  generation: number;
  awaitId: string;
  documentId: string;
};

function snippetRequest(value: unknown): SnippetRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('key' in value) ||
    typeof value.key !== 'number' ||
    !('generation' in value) ||
    typeof value.generation !== 'number' ||
    !('awaitId' in value) ||
    typeof value.awaitId !== 'string' ||
    !('documentId' in value) ||
    typeof value.documentId !== 'string'
  )
    throw new Error('Invalid native snippet request');
  return {
    key: value.key,
    generation: value.generation,
    awaitId: value.awaitId,
    documentId: value.documentId,
  };
}

/**
 * Source snippetsPlugin over the native model: the model swaps the `;` search
 * for an await placeholder, the host fetches the snippet, and the model
 * replaces the placeholder (or clears it when the fetch fails).
 */
export function createNativeSnippetMenuHost(
  view: EditorView,
  menu: MenuOperations,
  options: { sourceDocumentId: string; alive: () => boolean }
): { host: SnippetMenuHost; dispose: () => void } {
  const active = () => options.alive() && view.isMounted;
  const resolve = async (request: SnippetRequest) => {
    let source: Awaited<ReturnType<typeof fetchSnippetRaw>> | null = null;
    try {
      source = await fetchSnippetRaw({ documentId: request.documentId });
    } catch (error) {
      Telemetry.error(error, { surface: 'native-snippet-fetch' });
    }
    if (!active() || view.mirror.keyGeneration !== request.generation) return;
    dispatchApplicationCommandIfSessionEdit(
      view,
      'group-a.snippet-resolve-source',
      {
        key: request.key,
        awaitId: request.awaitId,
        // The fetched state is plain JSON; the round trip gives it the JSON type.
        source: source === null ? null : JSON.parse(JSON.stringify(source)),
      }
    );
  };
  const dispose = view.onPluginEvent('group-a.snippet-request', (payload) => {
    fireAndForget(resolve(snippetRequest(payload)), 'native-snippet-fetch');
  });
  const host: SnippetMenuHost = {
    root: () => (active() ? view.root : null),
    closeSearch() {
      // Closing the UI writes only under current session edit access.
      if (active())
        dispatchApplicationCommandIfSessionEdit(
          view,
          'group-a.search-close',
          {}
        );
    },
    insertSnippet(documentId, sourceDocumentId) {
      const source = sourceDocumentId ?? options.sourceDocumentId;
      if (!active() || source === documentId) return;
      menu.setSearchTerm('');
      menu.setIsOpen(false);
      dispatchApplicationCommandIfSessionEdit(view, 'group-a.snippet-insert', {
        documentId,
        sourceDocumentId: source,
      });
    },
  };
  return { host, dispose };
}

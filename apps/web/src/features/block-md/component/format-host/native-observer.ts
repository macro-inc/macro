import { createNativeListenerScope } from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners';
import type {
  EditorView,
  LatestPublishedObserver,
  LatestPublishedUnavailable,
} from '@macro-inc/lexical-wasm-view';
import type { ViewSelection } from '@macro-inc/lexical-wasm-view/view/types';
import {
  type Accessor,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from 'solid-js';
import { createNativeDocumentFormattingHost } from './native';
import { createNativeDocumentLinkMenuHost } from './native-link-host';
import { createNativeSnippetLink } from './native-snippet';

type Controller = ReturnType<typeof createNativeDocumentFormattingHost>;

/** Install before session construction; materialize UI ports only on real publication. */
export function createNativeDocumentFormattingObserver(options: {
  canEdit: Accessor<boolean>;
  alive: Accessor<boolean>;
  /** Copy link to snippet: the document whose URL is shared. */
  snippetLink?: { readonly documentId: Accessor<string> };
  /** Source popupPlugin `$allowEmptySelection` (consulted on touch only). */
  allowEmptySelection?: (selection: ViewSelection) => boolean;
}) {
  const owner = getOwner();
  if (!owner) throw new Error('Native formatting requires its actual UI owner');
  const [controller, setController] = createSignal<Controller>();
  const [links, setLinks] =
    createSignal<ReturnType<typeof createNativeDocumentLinkMenuHost>>();
  const [snippetLink, setSnippetLink] =
    createSignal<ReturnType<typeof createNativeSnippetLink>>();
  let attached: EditorView | undefined;
  let terminal = false;

  const retire = (reason?: LatestPublishedUnavailable) => {
    if (terminal) return;
    terminal = true;
    attached = undefined;
    // Capture before cleanup: the scope releases in reverse and clears accessors.
    const currentSnippet = snippetLink();
    const cleanup = createNativeListenerScope();
    cleanup.add(() => setController(undefined));
    cleanup.add(() => setLinks(undefined));
    cleanup.add(() => links()?.retire());
    cleanup.add(() => setSnippetLink(undefined));
    cleanup.add(() => currentSnippet?.dispose());
    cleanup.add(() =>
      reason
        ? controller()?.observer.unavailable(reason)
        : controller()?.observer.retired()
    );
    cleanup.dispose();
  };
  const observer: LatestPublishedObserver = {
    published(view) {
      if (terminal) return;
      if (attached && attached !== view)
        throw new Error('Native formatting view owner changed');
      attached = view;
      let current = controller();
      if (!current) {
        const next = runWithOwner(owner, () => {
          const link = createNativeDocumentLinkMenuHost(view, options);
          const cleanup = createNativeListenerScope();
          cleanup.add(() => link.dispose());
          try {
            const format = createNativeDocumentFormattingHost(view, {
              ...options,
              links: link,
            });
            // Own each issued handle before the next fallible constructor.
            cleanup.add(() => format.dispose());
            const snippet =
              options.snippetLink &&
              createNativeSnippetLink(view, options.snippetLink);
            return { link, format, snippet };
          } catch (error) {
            return cleanup.fail(error);
          }
        });
        if (!next) throw new Error('Native formatting UI owner is unavailable');
        try {
          next.format.observer.published(view);
        } catch (error) {
          const cleanup = createNativeListenerScope();
          cleanup.add(() => next.link.dispose());
          cleanup.add(() => next.format.dispose());
          cleanup.add(() => next.snippet?.dispose());
          return cleanup.fail(error);
        }
        setLinks(next.link);
        setSnippetLink(next.snippet);
        setController(next.format);
      } else current.observer.published(view);
    },
    unavailable: retire,
    retired: () => retire(),
  };
  onCleanup(() => {
    if (terminal || !attached?.isMounted) {
      retire();
      return;
    }
    terminal = true;
    attached = undefined;
    const currentController = controller();
    const currentLinks = links();
    const currentSnippet = snippetLink();
    const cleanup = createNativeListenerScope();
    cleanup.add(() => setController(undefined));
    cleanup.add(() => setLinks(undefined));
    cleanup.add(() => setSnippetLink(undefined));
    cleanup.add(() => currentSnippet?.dispose());
    cleanup.add(() => currentLinks?.dispose());
    cleanup.add(() => currentController?.dispose());
    cleanup.dispose();
  });
  return { observer, controller, links, snippetLink };
}

import {
  applyDomHighlights,
  unwrapDomHighlights,
} from '@core/util/searchHighlight';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';

/**
 * Mutates the rendered DOM under `root` to wrap term matches in highlight
 * spans. Kept outside any reactive component subtree (e.g. Lexical's
 * StaticMarkdown) so expensive decorator components don't re-mount when
 * the active search term changes.
 *
 * Re-applies when the root remounts (e.g. async citation replacement
 * recreates the markdown div), the source content changes (Solid wipes
 * the wrappers), or terms change.
 */
export function createSearchHighlightOverlay(args: {
  root: Accessor<HTMLElement | undefined>;
  content: Accessor<string>;
  terms: Accessor<readonly string[] | undefined>;
}): void {
  createEffect(
    on([args.root, args.content, args.terms], ([root, _content, terms]) => {
      if (!root) return;
      unwrapDomHighlights(root);
      if (!terms?.length) return;
      applyDomHighlights(root, terms);
    })
  );

  onCleanup(() => {
    const root = args.root();
    if (root) unwrapDomHighlights(root);
  });
}

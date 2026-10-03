import { type Accessor, createEffect, onCleanup } from 'solid-js';
import type { DocxComments } from './create-docx-comments';

let instances = 0;

/**
 * Paint comment highlights with the CSS Custom Highlight API, which styles
 * ranges without touching the editor's DOM, so commenting never interferes
 * with editing. Returns the stylesheet text for the per-instance names.
 */
export function createCommentHighlights(
  comments: DocxComments,
  enabled: Accessor<boolean>
): string {
  const id = ++instances;
  const base = `docx-comment-${id}`;
  const active = `docx-comment-active-${id}`;
  const supported = () => typeof CSS !== 'undefined' && 'highlights' in CSS;
  createEffect(() => {
    if (!supported()) return;
    const threads = enabled() ? comments.located() : [];
    const selected = comments.active();
    CSS.highlights.set(
      base,
      new Highlight(
        ...threads
          .filter((thread) => !thread.resolved && thread.id !== selected)
          .map((thread) => thread.range)
      )
    );
    CSS.highlights.set(
      active,
      new Highlight(
        ...threads
          .filter((thread) => thread.id === selected)
          .map((thread) => thread.range)
      )
    );
  });
  onCleanup(() => {
    if (!supported()) return;
    CSS.highlights.delete(base);
    CSS.highlights.delete(active);
  });
  return `::highlight(${base}) { background-color: oklch(from var(--color-yellow) l c h / 0.28); text-decoration: underline 2px oklch(from var(--color-yellow) l c h / 0.7); }
::highlight(${active}) { background-color: oklch(from var(--color-yellow) l c h / 0.55); text-decoration: underline 2px oklch(from var(--color-yellow) l c h / 0.9); }`;
}

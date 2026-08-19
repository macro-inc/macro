import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import type { usePropertyEntityDisplay } from '@property/hooks';
import { Show } from 'solid-js';

/** The resolved display accessors for one entity, from the shared resolver. */
export type EntityDisplay = ReturnType<typeof usePropertyEntityDisplay>;

/**
 * An activity row's entity reference rendered as a real document mention —
 * the same decorator the editor and notification rows use, with its hover
 * preview, access states, and click-to-open. Entity kinds without a block
 * mapping fall back to a plain icon + name chip.
 *
 * Takes the already-resolved display from the row (which also needs it for
 * click-to-open) rather than resolving its own, so each row subscribes to
 * the entity's preview once. Must render under a `<StaticMarkdownContext>`
 * ancestor.
 */
export function EntityMention(props: {
  entityId: string;
  display: EntityDisplay;
}) {
  const mentionMarkdown = () => {
    const blockName = props.display.blockOrFileType();
    if (!blockName) return undefined;
    return `<m-document-mention>${JSON.stringify({
      documentId: props.entityId,
      documentName: props.display.name(),
      blockName,
    })}</m-document-mention>`;
  };

  return (
    <Show
      when={mentionMarkdown()}
      fallback={
        <span class="inline-flex min-w-0 items-center gap-1.5 text-ink">
          <span class="flex shrink-0 items-center">{props.display.icon()}</span>
          <span class="truncate">{props.display.name()}</span>
        </span>
      }
    >
      {(markdown) => (
        <StaticMarkdown
          markdown={markdown()}
          theme={unifiedListMarkdownTheme}
          singleLine
        />
      )}
    </Show>
  );
}

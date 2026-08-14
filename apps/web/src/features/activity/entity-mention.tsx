import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Show } from 'solid-js';

/**
 * An activity row's entity reference rendered as a real document mention —
 * the same decorator the editor and notification rows use, with its hover
 * preview, access states, and click-to-open. Entity kinds without a block
 * mapping fall back to a plain icon + name chip.
 *
 * Must render under a `<StaticMarkdownContext>` ancestor.
 */
export function EntityMention(props: {
  entityId: string;
  entityType: EntityType;
}) {
  const display = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType
  );

  const mentionMarkdown = () => {
    const blockName = display.blockOrFileType();
    if (!blockName) return undefined;
    return `<m-document-mention>${JSON.stringify({
      documentId: props.entityId,
      documentName: display.name(),
      blockName,
    })}</m-document-mention>`;
  };

  return (
    <Show
      when={mentionMarkdown()}
      fallback={
        <span class="inline-flex min-w-0 items-center gap-1.5 text-ink">
          <span class="flex shrink-0 items-center">{display.icon()}</span>
          <span class="truncate">{display.name()}</span>
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

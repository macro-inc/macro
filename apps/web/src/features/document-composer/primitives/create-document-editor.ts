import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import type { MentionLinkResolver } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import { fireAndForget } from '@core/util/fireAndForget';
import type { InlineTagsPill } from '@property/tags';
import type { ComponentProps } from 'solid-js';

export type DocumentComposerTags = ComponentProps<
  typeof InlineTagsPill
>['docTags'];

/** Common document editing behavior; hosts own draft state and navigation. */
export function createDocumentEditor(options: {
  resolveAppLink?: MentionLinkResolver;
  tags?: DocumentComposerTags;
  onChange(value: string): void;
}) {
  const editor = buildConfig('markdown').withMentions();
  if (options.resolveAppLink)
    editor.withAppLinkResolver(options.resolveAppLink);
  const tags = options.tags;
  if (tags)
    editor.withTags({
      applyTargetLabel: 'Document',
      isApplied: (tag) => tags.isApplied(tag.optionId),
      onCreate: (tag) => {
        fireAndForget(
          tags.applyTag(tag.scope, tag.optionId),
          'document-composer'
        );
      },
    });
  return editor
    .withEmojis()
    .withActions()
    .withCode()
    .withMedia({ fileDrop: true })
    .withSelectionData()
    .withFloatingFormatMenu()
    .withHistory()
    .onChange(options.onChange);
}

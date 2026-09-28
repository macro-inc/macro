import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { $generateNodesFromDOM } from '@lexical/html';
import { plainRichText, type RichText } from '@macro-inc/graphics';
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  type LexicalEditor,
} from 'lexical';
import { serializeCanvasTextState } from './text-serialization';

/** The canvas persists exactly the tree produced by the shared editor. */
export function serializeCanvasText(editor: LexicalEditor): RichText {
  return editor.read(() =>
    serializeCanvasTextState(editor.getEditorState().toJSON())
  );
}
export function createCanvasTextConfig(onChange: (content: RichText) => void) {
  // The disposable canvas has no source document or mention notifications.
  return buildConfig('markdown')
    .namespace('canvas-next-text')
    .withHistory()
    .withMentions({ block: 'canvas', disableMentionTracking: true })
    .withLinks()
    .withCode()
    .withFloatingFormatMenu({ extendedInlineFormats: true })
    .use((editor) =>
      editor.registerUpdateListener(
        ({ editorState, dirtyElements, dirtyLeaves }) => {
          if (dirtyElements.size || dirtyLeaves.size)
            onChange(serializeCanvasTextState(editorState.toJSON()));
        }
      )
    );
}

/** Rich paste uses the same registered nodes and replacements as the builder. */
export function importTextClipboard(text: string, html?: string): RichText {
  if (!html) return plainRichText(text);
  const wrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'canvas-paste',
    isInteractable: () => false,
  });
  try {
    const dom = new DOMParser().parseFromString(html, 'text/html');
    dom
      .querySelectorAll('script,style,iframe,object,embed')
      .forEach((node) => node.remove());
    for (const link of dom.querySelectorAll('a')) {
      const href = link.getAttribute('href') ?? '';
      if (!/^(https?:\/\/|mailto:)/i.test(href)) link.removeAttribute('href');
    }
    wrapper.editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        let paragraph: ReturnType<typeof $createParagraphNode> | undefined;
        for (const node of $generateNodesFromDOM(wrapper.editor, dom)) {
          if ($isElementNode(node) && !node.isInline()) {
            paragraph = undefined;
            root.append(node);
          } else {
            if (!paragraph) {
              paragraph = $createParagraphNode();
              root.append(paragraph);
            }
            paragraph.append(node);
          }
        }
        if (!root.getChildrenSize()) root.append($createParagraphNode());
      },
      { discrete: true }
    );
    return serializeCanvasText(wrapper.editor);
  } finally {
    wrapper.cleanup();
  }
}

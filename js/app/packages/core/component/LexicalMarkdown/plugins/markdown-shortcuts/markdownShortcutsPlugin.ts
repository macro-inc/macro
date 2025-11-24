import { registerMarkdownShortcuts, type Transformer } from '@lexical/markdown';
import { mergeRegister } from '@lexical/utils';
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical';

function getRegExp(transformer: Transformer) {
  const { type } = transformer;
  switch (type) {
    case 'element':
      return transformer.regExp;
    case 'multiline-element':
      return transformer.regExpStart;
    case 'text-format':
    case 'text-match':
      return null;
  }
}

export type MarkdownShortcutsPluginProps = {
  transformers: Transformer[];
  triggerOnEnterTransformers: Transformer[];
};

function registerMarkdownShortcutsPlugins(
  editor: LexicalEditor,
  props: MarkdownShortcutsPluginProps
) {
  // Not all editor flavors support all nodes. Filter the available markdown shortcuts
  // to only those with all dependencies available.
  const transformers = props.transformers.filter((transformer) => {
    if (
      transformer.type === 'element' ||
      transformer.type === 'multiline-element'
    ) {
      const deps = transformer.dependencies;
      return deps.every((dep) => editor.hasNode(dep));
    }
    return true;
  });

  return mergeRegister(
    registerMarkdownShortcuts(editor, transformers),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e: KeyboardEvent) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        const anchor = selection.anchor;
        const node = anchor.getNode();
        const textContent = node.getTextContent();

        for (const transformer of props.triggerOnEnterTransformers) {
          const regExp = getRegExp(transformer);
          if (!regExp) continue;

          if (regExp.test(textContent)) {
            const parent = node.getParent();
            if (parent && $isParagraphNode(parent)) {
              const match = textContent.match(regExp); // get the real match, since we care for the coercion here
              if (match) {
                if (transformer.type === 'multiline-element') {
                  transformer.replace(parent, [node], match, null, null, false);
                  node.remove();
                  e.preventDefault();
                  return true;
                } else if (transformer.type === 'element') {
                  transformer.replace(parent, [node], match, false);
                  node.remove();
                  e.preventDefault();
                  return true;
                }
              }
            }
          }
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function markdownShortcutsPlugin(props: MarkdownShortcutsPluginProps) {
  return (editor: LexicalEditor) =>
    registerMarkdownShortcutsPlugins(editor, props);
}

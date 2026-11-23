import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';

/** Focus the composer and open a typeahead as if its trigger was typed. */
export function openComposerTypeahead(
  lexical: LexicalEditor,
  command: LexicalCommand<void>
) {
  lexical.focus(() => {
    lexical.update(
      () => {
        if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const node = selection.anchor.getNode();
        const preceding = $isTextNode(node)
          ? node
              .getTextContent()
              .slice(selection.anchor.offset - 1, selection.anchor.offset)
          : '';
        if (preceding && !/\s/.test(preceding)) selection.insertText(' ');
      },
      {
        discrete: true,
        onUpdate: () => lexical.dispatchCommand(command, undefined),
      }
    );
  });
}

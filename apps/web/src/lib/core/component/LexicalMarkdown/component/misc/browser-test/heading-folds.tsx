import '@app/index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { onElementConnect } from '@core/util/onElementConnect';
import {
  $createHeadingNode,
  HeadingNode,
  type HeadingTagType,
  registerRichText,
} from '@lexical/rich-text';
import { $setId } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { createHeadingFolds } from '../../../plugins/heading-folds';
import { theme } from '../../../theme';
import { HeadingFoldControls } from '../HeadingFoldControls';

// The document editor's structure and 24px phone gutter: a positioned
// container whose only flow child is the full-width editor root (see block-md
// MarkdownEditor).
const DOCUMENT: [string, HeadingTagType | null, string][] = [
  ['intro', 'h1', 'Project plan'],
  ['p-intro', null, 'Everything we know about the launch, section by section.'],
  ['goals', 'h2', 'Goals'],
  [
    'p-goals',
    null,
    'Ship collapsible sections without changing the document format.',
  ],
  ['risks', 'h3', 'Risks'],
  [
    'p-risks',
    null,
    'Readers lose their place when a link points into hidden text.',
  ],
  ['timeline', 'h2', 'Timeline'],
  ['p-timeline', null, 'Two weeks of building, one week of review.'],
  ['appendix', 'h1', 'Appendix'],
  ['p-appendix', null, 'Sources and notes.'],
];

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const editor = createEditor({
    namespace: 'heading-folds-fixture',
    nodes: [HeadingNode],
    theme,
    onError: (error) => {
      throw error;
    },
  });
  const folds = createHeadingFolds({
    documentId: 'fixture-document',
    userId: 'fixture-user',
  });

  const unregister: (() => void)[] = [];
  onCleanup(() => {
    for (const fn of unregister) fn();
    editor.setRootElement(null);
  });
  // Lexical needs the root in the document to find its window.
  const mountRoot = (root: HTMLDivElement) =>
    onElementConnect(root, () => {
      editor.setRootElement(root);
      editor.update(
        () => {
          for (const [id, tag, text] of DOCUMENT) {
            const node = tag ? $createHeadingNode(tag) : $createParagraphNode();
            node.append($createTextNode(text));
            $setId(node, id);
            $getRoot().append(node);
          }
        },
        { discrete: true }
      );
      unregister.push(registerRichText(editor), folds.plugin(editor));
    });

  return (
    <main class="bg-page text-ink h-dvh overflow-y-auto px-6 py-6">
      <div class="mx-auto max-w-3xl">
        <div class="relative mt-1.5 text-base">
          <div
            ref={mountRoot}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Document content"
            class="w-full max-w-full min-h-52 outline-none"
          />
        </div>
        <HeadingFoldControls editor={editor} folds={folds} />
      </div>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);

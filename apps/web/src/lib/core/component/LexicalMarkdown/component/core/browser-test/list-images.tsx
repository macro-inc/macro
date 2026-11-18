import '@app/index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { $isListNode } from '@lexical/list';
import { $getRoot, $isElementNode, $isTextNode } from 'lexical';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { MarkdownShell } from '../../../builder/MarkdownShell';
import { initializeLexical } from '../../../init';
import { INSERT_MEDIA_COMMAND } from '../../../plugins/media';
import { StaticMarkdown, StaticMarkdownContext } from '../StaticMarkdown';

function imageUrl() {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#4f7cff';
    context.fillRect(0, 0, 320, 180);
  }
  return canvas.toDataURL('image/png');
}

initializeLexical();

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const [saved, setSaved] = createSignal('');
  const [itemIndex, setItemIndex] = createSignal(0);
  const editor = buildConfig('markdown')
    .namespace('list-images')
    .withHistory()
    .withMedia({ fileDrop: true });
  return (
    <StaticMarkdownContext>
      <main class="h-dvh overflow-y-auto p-6 bg-page text-ink max-w-2xl space-y-6">
        <h1 class="text-xl font-medium">Images in lists</h1>
        <MarkdownShell
          config={editor}
          initialValue={'1. First step\n2. Second step\n3. Third step'}
          ariaLabel="Document"
        />
        <label class="flex gap-2">
          Item
          <input
            aria-label="Item"
            type="number"
            class="w-16 border border-edge"
            value={itemIndex()}
            onInput={(event) => setItemIndex(event.currentTarget.valueAsNumber)}
          />
        </label>
        <button
          onClick={() => {
            editor.lexical.update(() => {
              // Where a tap at the end of the item's text puts the caret.
              const list = $getRoot().getFirstChild();
              if (!$isListNode(list)) return;
              const item = list.getChildAtIndex(itemIndex());
              if (!$isElementNode(item)) return;
              const text = item.getChildren().filter($isTextNode).at(-1);
              if (text) text.select();
              else item.selectEnd();
            });
            editor.lexical.focus();
          }}
        >
          Select item text end
        </button>
        <button
          onClick={() =>
            editor.lexical.dispatchCommand(INSERT_MEDIA_COMMAND, {
              type: 'url',
              url: imageUrl(),
              alt: 'Screenshot',
              mediaType: 'image',
            })
          }
        >
          Insert image
        </button>
        <button onClick={() => setSaved(editor.controls.getMarkdown())}>
          Save
        </button>
        <pre data-testid="saved-markdown">{saved()}</pre>
        <section data-testid="saved">
          <StaticMarkdown markdown={saved()} />
        </section>
      </main>
    </StaticMarkdownContext>
  );
}

render(() => <Fixture />, document.getElementById('root')!);

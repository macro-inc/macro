import '@app/index.css';
import { titleNavigationPlugin } from '@app/features/block-md/component/title-navigation';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Dropdown } from '@ui';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  FORMAT_TEXT_COMMAND,
} from 'lexical';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { initializeLexical } from '../../../init';
import { ComposerEditor } from '../../ComposerEditor';

initializeLexical();

/** The page's hooks for the test. */
type FocusGuardWindow = Window & {
  /** An update nobody asked for in the document, as a collaborator's edit is. */
  backgroundEdit?: () => void;
  /** `editor.focus()` on the document. */
  focusDocument?: () => void;
};

/**
 * A document editor with the ways the app changes its selection from outside
 * it: a toolbar button, a menu item, a prompt field that closes as it applies,
 * and a title editor above it (the real `titleNavigationPlugin`). Beside them
 * are fields of another pane (an input, a textarea, and another editor),
 * which keep focus while the document changes.
 */
function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const title = buildConfig('markdown').namespace('focus-guard-title');
  const body = buildConfig('markdown').namespace('focus-guard-body');
  const composer = buildConfig('markdown').namespace('focus-guard-composer');
  const [prompt, setPrompt] = createSignal(false);
  const [url, setUrl] = createSignal('');
  let saved: BaseSelection | null = null;

  onMount(() => {
    onCleanup(titleNavigationPlugin(body.lexical, () => false)(title.lexical));
  });

  const guardWindow: FocusGuardWindow = window;
  guardWindow.backgroundEdit = () =>
    body.lexical.update(() => {
      $getRoot().getLastChildOrThrow().append($createTextNode(' (edited)'));
    });
  guardWindow.focusDocument = () => body.lexical.focus();

  const removeFirstParagraph = () =>
    body.lexical.update(() => {
      const first = $getRoot().getFirstChildOrThrow();
      const next = first.getNextSibling();
      first.remove();
      next?.selectStart();
    });

  const insertParagraph = () =>
    body.lexical.update(() => {
      const paragraph = $createParagraphNode().append(
        $createTextNode('Inserted ')
      );
      $getRoot().getFirstChildOrThrow().insertAfter(paragraph);
      paragraph.selectEnd();
    });

  const openPrompt = () => {
    saved = body.lexical.read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) ? selection.clone() : null;
    });
    setPrompt(true);
  };

  // As the selection popup's link field does: restore the range, apply,
  // close the prompt, and call no focus().
  const applyPrompt = () => {
    body.lexical.update(() => {
      if (saved) $setSelection(saved);
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(`[${url()}]`);
    });
    setUrl('');
    setPrompt(false);
  };

  return (
    <main class="p-6 bg-page text-ink max-w-2xl space-y-6">
      <h1 class="text-xl font-medium">Editor focus guard</h1>
      <section class="space-y-2 border border-edge rounded p-4">
        <ComposerEditor
          config={title}
          initialValue="Title"
          ariaLabel="Title"
          autofocus={false}
        />
        <ComposerEditor
          config={body}
          initialValue={'First paragraph\n\nSecond paragraph'}
          ariaLabel="Document"
          autofocus={false}
        />
        <div class="flex gap-2">
          <button
            type="button"
            onClick={() =>
              body.lexical.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')
            }
          >
            Bold
          </button>
          <button type="button" onClick={removeFirstParagraph}>
            Remove first paragraph
          </button>
          <Dropdown>
            <Dropdown.Trigger>More</Dropdown.Trigger>
            {/* As the document's format menus do: back to the editor on close. */}
            <Dropdown.Content
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                body.lexical.focus();
              }}
            >
              <Dropdown.Group>
                <Dropdown.Item onSelect={insertParagraph}>
                  Insert paragraph
                </Dropdown.Item>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={openPrompt}
          >
            Link
          </button>
        </div>
        <Show when={prompt()}>
          <input
            aria-label="Link URL"
            ref={(element) => queueMicrotask(() => element.focus())}
            value={url()}
            onInput={(event) => setUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              applyPrompt();
            }}
          />
        </Show>
      </section>
      <section
        aria-label="Other pane"
        class="space-y-2 border border-edge rounded p-4"
      >
        <input aria-label="Subject" class="block border border-edge" />
        <textarea aria-label="Notes" class="block border border-edge" />
        <ComposerEditor
          config={composer}
          ariaLabel="Composer"
          autofocus={false}
        />
      </section>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);

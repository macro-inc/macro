import '@app/index.css';
import { FormatButtons } from '@app/features/channel/Input/FormatButtons';
import {
  applyInlineFormat,
  applyNodeFormat,
} from '@app/features/channel/Input/utils/formatting';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { $getRoot, $isTextNode } from 'lexical';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { channelTheme } from '../../../theme';
import { ComposerEditor } from '../../ComposerEditor';
import { StaticMarkdown, StaticMarkdownContext } from '../StaticMarkdown';

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const [saved, setSaved] = createSignal('');
  const editor = buildConfig('chat')
    .namespace('message-quotes')
    .withFloatingFormatMenu();
  return (
    <StaticMarkdownContext>
      <main class="p-6 bg-page text-ink max-w-2xl space-y-6">
        <h1 class="text-xl font-medium">Message quotes</h1>
        <Show when={isMobile()}>
          <div class="flex flex-wrap">
            <FormatButtons
              selectionState={() => editor.selection}
              onInlineFormat={(format) =>
                applyInlineFormat(editor.lexical, format)
              }
              onNodeFormat={(format) => applyNodeFormat(editor.lexical, format)}
            />
          </div>
        </Show>
        <ComposerEditor
          config={editor}
          initialValue={
            new URLSearchParams(window.location.search).get('initial') ??
            'First paragraph with enough words to wrap onto several lines.\n\nSecond paragraph with additional words.\n\nThird paragraph finishes the message.'
          }
          ariaLabel="Message"
        />
        <button onClick={() => setSaved(editor.controls.getMarkdown())}>
          Save message
        </button>
        <button
          onClick={() =>
            editor.lexical.update(() => {
              const text = $getRoot().getFirstDescendant();
              if ($isTextNode(text)) text.select(7, 14);
            })
          }
        >
          Select replacement text
        </button>
        <section data-testid="saved">
          <StaticMarkdown markdown={saved()} theme={channelTheme} />
        </section>
      </main>
    </StaticMarkdownContext>
  );
}

render(() => <Fixture />, document.getElementById('root')!);

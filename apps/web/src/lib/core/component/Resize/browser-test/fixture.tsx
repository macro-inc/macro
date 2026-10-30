import { registerPlainText } from '@lexical/plain-text';
import { Scroll } from '@ui/components/Scroll';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from 'lexical';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { createComposerLayout } from '../../LexicalMarkdown/utils/create-composer-layout';
import { Resize } from '../Resize';

function Composer() {
  const editor = createEditor();
  onCleanup(registerPlainText(editor));
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const layout = createComposerLayout(editor, { container });
  let input!: HTMLDivElement;
  onMount(() => {
    editor.setRootElement(input);
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode('A draft that wraps when the split becomes narrow.')
          )
        );
      },
      { discrete: true }
    );
  });
  onCleanup(() => editor.setRootElement(null));
  return (
    <div
      ref={setContainer}
      data-composer-compact={layout.isCompact()}
      class="composer"
    >
      <div
        ref={input}
        contentEditable={true}
        style={{ 'line-height': '20px', 'min-width': '0', flex: '1' }}
      />
      <button type="button" style={{ width: '100px', 'flex-shrink': '0' }}>
        Send
      </button>
    </div>
  );
}

function App() {
  return (
    <>
      <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; font: 16px monospace; }
      p { margin: 0; }
      .composer { display: flex; padding: 12px; gap: 12px; }
      .composer[data-composer-compact="false"] { flex-direction: column; }
    `}</style>
      <div style={{ width: '100vw', height: '100vh' }}>
        <Resize.Zone direction="horizontal" gutter={8}>
          <Resize.Panel id="left" minSize={180}>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                height: '100%',
              }}
            >
              <div style={{ flex: '1', 'min-height': '0' }}>
                <Scroll viewportProps={{ 'data-testid': 'scroller' }}>
                  <For each={Array.from({ length: 100 }, (_, index) => index)}>
                    {(index) => (
                      <p style={{ padding: '12px' }}>
                        Message {index}: text that rewraps as the split changes
                        width.
                      </p>
                    )}
                  </For>
                </Scroll>
              </div>
              <Composer />
            </div>
          </Resize.Panel>
          <Resize.Panel id="right" minSize={180}>
            <p>Second split</p>
          </Resize.Panel>
        </Resize.Zone>
      </div>
    </>
  );
}

render(() => <App />, document.getElementById('root')!);

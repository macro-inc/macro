import { Bar } from '@core/component/TopBar/Bar';
import { debounce } from '@solid-primitives/scheduled';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import {
  codePlugin,
  createAccessoryStore,
  mediaPlugin,
  mentionsPlugin,
  tabIndentationPlugin,
  tablePlugin,
} from '../../plugins';
import { editorIsEmpty, setEditorStateFromMarkdown } from '../../utils';
import { DecoratorRenderer } from '../core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '../core/NodeAccessoryRenderer';
import { StaticMarkdown, StaticMarkdownContext } from '../core/StaticMarkdown';

const KEYS = {
  content: 'internal-markdown-test-string',
  outputType: 'internal-markdown-output-type',
  targetType: 'internal-markdown-target-type',
};

const getSavedStringFromLocalStorage = () => {
  try {
    const savedString = localStorage.getItem(KEYS.content);
    if (savedString) {
      return savedString;
    }
  } catch (_) {}
  return '';
};

const getSavedOutputType = (): 'static' | 'editor' => {
  try {
    const saved = localStorage.getItem(KEYS.outputType);
    if (saved === 'static' || saved === 'editor') {
      return saved;
    }
  } catch (_) {}
  return 'static';
};

const getSavedTargetType = (): 'internal' | 'external' | 'both' => {
  try {
    const saved = localStorage.getItem(KEYS.targetType);
    if (saved === 'internal' || saved === 'external' || saved === 'both') {
      return saved;
    }
  } catch (_) {}
  return 'internal';
};

export function TestEditor(props: {
  value: Accessor<string>;
  target: Accessor<'internal' | 'external' | 'both'>;
}) {
  let mountRef!: HTMLDivElement;
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'markdown-textarea',
    isInteractable: () => true,
  });
  const { editor, plugins, cleanup: cleanupLexical } = lexicalWrapper;
  setEditorStateFromMarkdown(editor, props.value(), props.target());
  const debouncedUpdateMarkdown = debounce(
    (markdown: string, target: 'internal' | 'external' | 'both') => {
      setEditorStateFromMarkdown(editor, markdown, target);
    },
    50
  );

  createEffect(() => {
    const value = props.value();
    debouncedUpdateMarkdown(value, props.target());
  });

  const [showPlaceholder, setShowPlaceholder] = createSignal(true);

  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .history(400)
    .use(tabIndentationPlugin())
    .use(mentionsPlugin({}))
    .use(mediaPlugin())
    .use(tablePlugin({}));

  const [accessoryStore, setAccessoryStore] = createAccessoryStore();
  plugins.use(
    codePlugin({
      accessories: accessoryStore,
      setAccessories: setAccessoryStore,
    })
  );

  onMount(() => {
    editor.setRootElement(mountRef);
    editor.setEditable(false);
  });

  onCleanup(() => {
    cleanupLexical();
  });

  createEffect(() => {
    props.value();
    setShowPlaceholder(editorIsEmpty(editor));
  });

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div ref={mountRef} contentEditable={false}></div>
      <DecoratorRenderer editor={editor} />
      <NodeAccessoryRenderer editor={editor} store={accessoryStore} />
      <Show when={showPlaceholder()}>
        <div class="pointer-events-none text-ink-extra-muted absolute top-0">
          <p class="my-1.5">...</p>
        </div>
      </Show>
    </LexicalWrapperContext.Provider>
  );
}
export default function MarkdownParseTestPage() {
  const [rawMarkdown, setRawMarkdown] = createSignal(
    getSavedStringFromLocalStorage()
  );

  const [outputType, setOutputType] = createSignal<'static' | 'editor'>(
    getSavedOutputType()
  );
  const [targetType, setTargetType] = createSignal<
    'internal' | 'external' | 'both'
  >(getSavedTargetType());

  const debouncedLocalSave = debounce(() => {
    const markdown = rawMarkdown();
    const output = outputType();
    const target = targetType();

    try {
      localStorage.setItem(KEYS.content, markdown);
      localStorage.setItem(KEYS.outputType, output);
      localStorage.setItem(KEYS.targetType, target);
    } catch (_) {}
  });

  createEffect(() => {
    rawMarkdown();
    outputType();
    targetType();
    debouncedLocalSave();
  });

  return (
    <div class="flex flex-col h-full w-full">
      <Bar
        left={<div class="p-2 text-sm w-2xl truncate">Markdown Parse Test</div>}
        center={<div></div>}
      ></Bar>
      <div class="w-full h-full flex">
        <div class="w-1/2 h-full p-4 flex flex-col border-r border-edge">
          <h2 class="text-sm mb-2">Input Markdown</h2>
          <textarea
            class="w-full h-full p-4 resize-none border border-edge rounded font-mono text-ink text-sm bg-input"
            placeholder="Test markdown here..."
            value={rawMarkdown()}
            onInput={(e) => setRawMarkdown(e.target.value)}
            spellcheck={false}
          />
        </div>

        <div class="w-1/2 h-full p-4 flex flex-col">
          <h2 class="text-sm mb-2">Output</h2>
          <div class="h-px bg-edge mb-2"></div>

          <div class="flex gap-16 mb-4">
            <div class="flex items-center gap-1">
              <span class="text-sm text-ink-extra-muted">Render as</span>
              <div class="flex bg-edge/50 rounded border-1 border-edge overflow-hidden">
                <button
                  class={`px-3 py-1 text-sm ${outputType() === 'static' ? 'bg-accent text-panel' : ''} border-r-1 border-edge`}
                  onClick={() => setOutputType('static')}
                >
                  Static
                </button>
                <button
                  class={`px-3 py-1 text-sm ${outputType() === 'editor' ? 'bg-accent text-panel' : ''}`}
                  onClick={() => setOutputType('editor')}
                >
                  Editor
                </button>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-sm text-ink-extra-muted">Target</span>
              <div class="flex bg-edge/50 rounded border-1 border-edge overflow-hidden">
                <button
                  class={`px-3 py-1 text-sm ${targetType() === 'internal' ? 'bg-accent text-panel' : ''} border-r-1 border-edge`}
                  onClick={() => setTargetType('internal')}
                >
                  Internal
                </button>
                <button
                  class={`px-3 py-1 text-sm ${targetType() === 'external' ? 'bg-accent text-panel' : ''}`}
                  onClick={() => setTargetType('external')}
                >
                  External
                </button>
                <button
                  class={`px-3 py-1 text-sm ${targetType() === 'both' ? 'bg-accent text-panel' : ''}`}
                  onClick={() => setTargetType('both')}
                >
                  Both
                </button>
              </div>
            </div>
          </div>

          <div class="flex-1 overflow-auto bg-input border border-edge rounded p-4">
            <Show when={outputType() === 'static'}>
              <StaticMarkdownContext>
                <StaticMarkdown
                  markdown={rawMarkdown()}
                  target={targetType()}
                />
              </StaticMarkdownContext>
            </Show>

            <Show when={outputType() === 'editor'}>
              <div class="overflow-auto min-h-8 h-full relative">
                <TestEditor value={rawMarkdown} target={targetType} />
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

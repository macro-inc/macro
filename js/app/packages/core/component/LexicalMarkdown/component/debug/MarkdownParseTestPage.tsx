import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
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
import {
  editorIsEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../../utils';
import { DecoratorRenderer } from '../core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '../core/NodeAccessoryRenderer';
import { StaticMarkdown, StaticMarkdownContext } from '../core/StaticMarkdown';

const KEYS = {
  content: 'internal-markdown-test-string',
  outputType: 'internal-markdown-output-type',
  targetType: 'internal-markdown-target-type',
  inputType: 'internal-markdown-input-type',
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

const getSavedInputType = (): 'markdown' | 'lexical-json' => {
  try {
    const saved = localStorage.getItem(KEYS.inputType);
    if (saved === 'markdown' || saved === 'lexical-json') {
      return saved;
    }
  } catch (_) {}
  return 'markdown';
};

export function TestEditor(props: {
  value: Accessor<string>;
  target: Accessor<'internal' | 'external' | 'both'>;
  inputType: Accessor<'markdown' | 'lexical-json'>;
}) {
  let mountRef!: HTMLDivElement;
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'markdown-textarea',
    isInteractable: () => true,
  });
  const { editor, plugins, cleanup: cleanupLexical } = lexicalWrapper;
  const setEditorContent = (
    content: string,
    target: 'internal' | 'external' | 'both',
    inputType: 'markdown' | 'lexical-json'
  ) => {
    if (inputType === 'lexical-json') {
      try {
        const parsed = JSON.parse(content);
        initializeEditorWithState(editor, parsed);
      } catch (error) {
        console.error('Invalid JSON:', error);
      }
    } else {
      setEditorStateFromMarkdown(editor, content, target);
    }
  };

  setEditorContent(props.value(), props.target(), props.inputType());
  const debouncedUpdateContent = debounce(
    (
      content: string,
      target: 'internal' | 'external' | 'both',
      inputType: 'markdown' | 'lexical-json'
    ) => {
      setEditorContent(content, target, inputType);
    },
    50
  );

  createEffect(() => {
    const value = props.value();
    const target = props.target();
    const inputType = props.inputType();
    debouncedUpdateContent(value, target, inputType);
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
  const [rawContent, setRawContent] = createSignal(
    getSavedStringFromLocalStorage()
  );

  const [outputType, setOutputType] = createSignal<'static' | 'editor'>(
    getSavedOutputType()
  );
  const [targetType, setTargetType] = createSignal<
    'internal' | 'external' | 'both'
  >(getSavedTargetType());
  const [inputType, setInputType] = createSignal<'markdown' | 'lexical-json'>(
    getSavedInputType()
  );

  const debouncedLocalSave = debounce(() => {
    const content = rawContent();
    const output = outputType();
    const target = targetType();
    const input = inputType();

    try {
      localStorage.setItem(KEYS.content, content);
      localStorage.setItem(KEYS.outputType, output);
      localStorage.setItem(KEYS.targetType, target);
      localStorage.setItem(KEYS.inputType, input);
    } catch (_) {}
  });

  createEffect(() => {
    rawContent();
    outputType();
    targetType();
    inputType();
    debouncedLocalSave();
  });

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Lexical Parse Playground" />
      </SplitHeaderLeft>
      <div class="flex flex-col h-full w-full">
        <div class="w-full h-full flex">
          <div class="w-1/2 h-full p-4 flex flex-col border-r border-edge">
            <div class="flex items-center gap-2 mb-2">
              <h2 class="text-sm">Input</h2>
              <div class="flex bg-edge/50 rounded border-1 border-edge overflow-hidden">
                <button
                  class={`px-2 py-0.5 text-xs ${inputType() === 'markdown' ? 'bg-accent text-panel' : ''} border-r-1 border-edge`}
                  onClick={() => setInputType('markdown')}
                >
                  Markdown
                </button>
                <button
                  class={`px-2 py-0.5 text-xs ${inputType() === 'lexical-json' ? 'bg-accent text-panel' : ''}`}
                  onClick={() => setInputType('lexical-json')}
                >
                  Lexical JSON
                </button>
              </div>
            </div>
            <textarea
              class="w-full h-full p-4 resize-none border border-edge rounded font-mono text-ink text-sm bg-input"
              placeholder={
                inputType() === 'markdown'
                  ? 'Test markdown here...'
                  : 'Test lexical JSON here...'
              }
              value={rawContent()}
              onInput={(e) => setRawContent(e.target.value)}
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
                  <Show when={inputType() === 'markdown'}>
                    <StaticMarkdown
                      markdown={rawContent()}
                      target={targetType()}
                    />
                  </Show>
                  <Show when={inputType() === 'lexical-json'}>
                    <div class="text-ink-muted text-sm">
                      Static rendering not supported for Lexical JSON input. Use
                      Editor output to view JSON content.
                    </div>
                  </Show>
                </StaticMarkdownContext>
              </Show>

              <Show when={outputType() === 'editor'}>
                <div class="overflow-auto min-h-8 h-full relative">
                  <TestEditor
                    value={rawContent}
                    target={targetType}
                    inputType={inputType}
                  />
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

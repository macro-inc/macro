import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { NodeKey } from 'lexical';
import { createEffect, createSignal, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { TRY_UPDATE_EQUATION_COMMAND } from '../../plugins';

export function Equation(props: {
  equation: string;
  inline: boolean;
  key?: NodeKey;
}) {
  const [katexElementRef, setKatexElementRef] = createSignal<
    HTMLElement | undefined
  >(undefined);

  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key ?? '');
  };

  createEffect(() => {
    const katexElement = katexElementRef();

    if (katexElement) {
      katex.render(props.equation, katexElement, {
        displayMode: !props.inline,
        errorColor: '#cc0000',
        output: 'html',
        strict: 'warn',
        throwOnError: false,
        trust: false,
      });
    }
  });

  return (
    <div
      class={`inline-block ${isSelectedAsNode() ? 'bg-hover' : ''} ${props.key ? 'hover:bg-hover' : ''}`}
      role="button"
      tabIndex={-1}
      onDblClick={() => {
        const key = props.key;
        const editor = lexicalWrapper?.editor;
        if (key && editor) {
          editor.dispatchCommand(TRY_UPDATE_EQUATION_COMMAND, key);
        }
      }}
    >
      <span ref={setKatexElementRef} class="block" />
    </div>
  );
}

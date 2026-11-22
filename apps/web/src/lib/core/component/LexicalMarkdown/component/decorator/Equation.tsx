import { cn } from '@ui';
import type { NodeKey } from 'lexical';
import { createEffect, createSignal, onMount } from 'solid-js';
import { useEquationHost } from '../../decorator-host/equation-host';

// Lazy load katex - will be loaded on first render
let katexModule: typeof import('katex') | null = null;
let katexLoaded = false;

async function loadKatex() {
  if (katexLoaded) return katexModule;
  const [mod] = await Promise.all([
    import('katex'),
    import('katex/dist/katex.min.css'),
  ]);
  katexModule = mod;
  katexLoaded = true;
  return mod;
}

export function Equation(props: {
  equation: string;
  inline: boolean;
  key?: NodeKey;
}) {
  const [katexElementRef, setKatexElementRef] = createSignal<
    HTMLElement | undefined
  >(undefined);
  const [isKatexReady, setIsKatexReady] = createSignal(katexLoaded);

  const host = useEquationHost();
  const isSelectedAsNode = () => host.isSelected(props.key ?? '');

  onMount(async () => {
    if (!katexLoaded) {
      await loadKatex();
      setIsKatexReady(true);
    }
  });

  createEffect(() => {
    const katexElement = katexElementRef();
    const ready = isKatexReady();

    if (katexElement && ready && katexModule) {
      katexModule.default.render(props.equation, katexElement, {
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
      class={cn(
        'inline-block',
        isSelectedAsNode() && 'bg-hover',
        props.key && 'hover:bg-hover'
      )}
      role="button"
      tabIndex={-1}
      onDblClick={() => {
        const key = props.key;
        if (key) host.equation.requestEdit(key);
      }}
    >
      <span ref={setKatexElementRef} class="block" />
    </div>
  );
}

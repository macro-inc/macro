import {
  $createDocumentMentionNode,
  type DocumentMentionInfo,
} from '@macro-inc/lexical-core/nodes/DocumentMentionNode';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalEditor,
} from 'lexical';
import { createSignal, onCleanup, onMount } from 'solid-js';

type Token = string | DocumentMentionInfo;
const parts: Token[] = [
  'Hi Dana,',
  '\n',
  'Thanks for joining the demo on September 14. Great meeting your team!',
  '\n',
  'Here’s our ',
  {
    documentId: 'homepage-sales-pdf',
    documentName: 'Macro sales overview.pdf',
    blockName: 'pdf',
  },
  ' and the ',
  {
    documentId: 'homepage-rollout-doc',
    documentName: 'Team rollout plan',
    blockName: 'md',
  },
  '.',
  '\n',
  'I’ve cc’d Julia to help with setup. Does Thursday at 9 AM work for a follow-up?',
  '\n',
  'Best,\nJacob',
];
const tokens = parts.flatMap((part): Token[] =>
  typeof part === 'string'
    ? part
        .split(/(\n)/)
        .flatMap((text) =>
          text === '\n' ? [text] : (text.match(/\S+[^\S\n]*|[^\S\n]+/g) ?? [])
        )
    : [part]
);

/** Append tokens to the real editor without rebuilding its existing nodes. */
export function createEmailDemoGeneration(
  element: () => HTMLElement | undefined,
  editor: () => LexicalEditor
) {
  const [phase, setPhase] = createSignal<
    'waiting' | 'loading' | 'generating' | 'complete'
  >('waiting');
  let ready = false;
  let visible = false;
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reduced: MediaQueryList | undefined;

  const append = (items: Token[]) => {
    editor().update(
      () => {
        const root = $getRoot();
        for (const item of items) {
          let paragraph = root.getLastChild();
          if (!$isElementNode(paragraph) || item === '\n') {
            paragraph = $createParagraphNode();
            root.append(paragraph);
          }
          if (!$isElementNode(paragraph) || item === '\n') continue;
          if (typeof item !== 'string') {
            paragraph.append($createDocumentMentionNode(item));
            continue;
          }
          const last = paragraph.getLastChild();
          if ($isTextNode(last))
            last.setTextContent(last.getTextContent() + item);
          else paragraph.append($createTextNode(item));
        }
      },
      { tag: 'history-merge' }
    );
  };
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const run = () => {
    stop();
    if (!ready || phase() === 'complete') return;
    if (reduced?.matches) {
      append(tokens.slice(index));
      index = tokens.length;
      setPhase('complete');
      return;
    }
    if (!visible || document.hidden) return;
    if (phase() === 'waiting') setPhase('loading');
    const delay = phase() === 'loading' ? 1000 : 32;
    timer = setTimeout(() => {
      timer = undefined;
      setPhase('generating');
      append([tokens[index++]]);
      if (index === tokens.length) setPhase('complete');
      else run();
    }, delay);
  };
  onMount(() => {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.addEventListener('change', run);
    document.addEventListener('visibilitychange', run);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        run();
      },
      { threshold: 0.2 }
    );
    const root = element();
    if (root) observer.observe(root);
    run();
    onCleanup(() => {
      stop();
      observer.disconnect();
      reduced?.removeEventListener('change', run);
      document.removeEventListener('visibilitychange', run);
    });
  });
  return {
    phase,
    onReady: () => {
      ready = true;
      run();
    },
  };
}

import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { z } from 'zod';

const CODE_TYPE = 'custom-code';
const REPORT = z.object({
  key: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  language: z.string().nullable(),
});

type IsCodeLanguageLoaded = (language: string) => boolean;

/** Source updateCodeGutter: line numbers from LineBreak children, cached on child count. */
function updateCodeGutter(
  view: EditorView,
  key: number,
  cachedChildren: WeakMap<HTMLElement, number>
) {
  const element = view.getElementByKey(key);
  const node = view.node(key);
  if (!element || !node) return;
  if (cachedChildren.get(element) === node.children.length) return;
  cachedChildren.set(element, node.children.length);
  let gutter = '1';
  let count = 1;
  for (const child of node.children) {
    if (view.node(child)?.kind === 'linebreak') gutter += '\n' + ++count;
  }
  element.setAttribute('data-gutter', gutter);
}

/**
 * Source code-highlighting DOM for native code blocks. `data-gutter` follows the
 * Source CodeNode mutation listener. `data-highlight-language` is present exactly
 * while the last highlighter transform run found the block's language loaded:
 * the model reports each run (group-b.code-highlight), a replaced element gets
 * the retained state back, and the grammar check loads off the startup path.
 */
export function installNativeCodeHighlightDOM(view: EditorView) {
  const reported = new Map<number, string | null>();
  const cachedChildren = new WeakMap<HTMLElement, number>();
  let isLoaded: IsCodeLanguageLoaded | undefined;
  let disposed = false;
  let loading = false;

  const apply = (key: number) => {
    if (!isLoaded) return;
    const element = view.getElementByKey(key);
    if (!element) return;
    const language = reported.get(key);
    if (language && isLoaded(language))
      element.setAttribute('data-highlight-language', language);
    else element.removeAttribute('data-highlight-language');
  };

  const loadGrammarCheck = async () => {
    const module = await import(
      '@macro-inc/lexical-wasm-view/view/code-highlight'
    );
    if (disposed) return;
    isLoaded = module.isCodeLanguageLoaded;
    for (const key of reported.keys()) apply(key);
  };

  const releaseReports = view.onPluginEvent('group-b.code-highlight', (raw) => {
    const report = REPORT.parse(raw);
    if (report.generation !== view.mirror.keyGeneration) return;
    if (!loading) {
      loading = true;
      fireAndForget(loadGrammarCheck(), 'native-code-highlight-language');
    }
    reported.set(report.key, report.language);
    apply(report.key);
  });
  for (const node of view.mirror.values())
    if (node.type === CODE_TYPE)
      updateCodeGutter(view, node.key, cachedChildren);
  const releaseMutations = view.onMutations(CODE_TYPE, (mutations) => {
    for (const [key, mutation] of mutations) {
      if (mutation === 'destroyed') {
        reported.delete(key);
        continue;
      }
      updateCodeGutter(view, key, cachedChildren);
      if (reported.has(key)) apply(key);
    }
  });
  return () => {
    disposed = true;
    releaseReports();
    releaseMutations();
    reported.clear();
  };
}

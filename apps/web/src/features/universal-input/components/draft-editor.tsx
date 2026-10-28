import type { EditorConfigBuilder } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { ComposerEditor } from '@core/component/LexicalMarkdown/component/ComposerEditor';
import { $createRangeSelection, $getRoot, $setSelection } from 'lexical';
import { createEffect, createSignal, untrack } from 'solid-js';

/** Keep the Lexical document mounted while inference reveals editable fields. */
export function DraftEditor(props: {
  config: EditorConfigBuilder;
  text: string;
  disabled: boolean;
  onChange: (markdown: string) => void;
  onSubmit: () => void;
  initialSelection?: { start: number; end: number };
  registerFocus?: (focus: () => void) => void;
}) {
  const [connected, setConnected] = createSignal(false);
  const initialValue = untrack(() => props.text);
  const config = props.config
    .onChange((markdown) => {
      if (markdown !== props.text) props.onChange(markdown);
    })
    .onEnter((event) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.isComposing ||
        config.controls.isInlineMenuOpen()
      )
        return false;
      props.onSubmit();
      return true;
    });

  // External draft restoration and successful submission update the editor.
  // Ordinary typing must keep Lexical's selection, formatting and undo history.
  createEffect(() => {
    if (!connected()) return;
    const text = props.text;
    untrack(() => {
      if (text !== config.controls.getMarkdown())
        config.controls.setMarkdown(text);
    });
  });

  return (
    <div class="relative flex min-w-0 flex-1 flex-col justify-center">
      <ComposerEditor
        config={config}
        placeholder="Your input"
        initialValue={initialValue}
        disabled={props.disabled}
        class="h-auto! [&>[data-markdown-editable]]:max-h-80! [&>[data-markdown-editable]]:outline-none [&>[data-markdown-placeholder]]:hidden min-h-0! py-0.5 text-[length:inherit]! leading-[inherit]! [&>[data-markdown-editable]]:min-h-0! [&>[data-markdown-editable]]:text-ink-muted [&>[data-markdown-editable]]:leading-[inherit]!"
        refFn={(element) => {
          element.setAttribute('aria-label', 'Your input');
          element.setAttribute('data-universal-input', '');
        }}
        onConnect={() => {
          setConnected(true);
          props.registerFocus?.(() => config.controls.focus());
          const selection = props.initialSelection;
          if (selection) {
            const editor = config.controls.getLexical();
            editor.update(
              () => {
                const nodes = $getRoot().getAllTextNodes();
                if (!nodes.length) return;
                const range = $createRangeSelection();
                const pointAt = (offset: number) => {
                  for (const node of nodes) {
                    const length = node.getTextContentSize();
                    if (offset <= length) return { node, offset };
                    offset -= length;
                  }
                  const node = nodes[nodes.length - 1];
                  return { node, offset: node.getTextContentSize() };
                };
                const anchor = pointAt(selection.start);
                const focus = pointAt(selection.end);
                range.anchor.set(anchor.node.getKey(), anchor.offset, 'text');
                range.focus.set(focus.node.getKey(), focus.offset, 'text');
                $setSelection(range);
              },
              { discrete: true }
            );
            editor.getRootElement()?.focus();
          }
        }}
      />
    </div>
  );
}

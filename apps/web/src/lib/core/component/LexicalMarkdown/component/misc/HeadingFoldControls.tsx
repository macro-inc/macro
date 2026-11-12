import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretDown from '@icon/system/regular/caret-down.svg';
import { Button, cn } from '@ui';
import type { LexicalEditor } from 'lexical';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { MarkdownStackingContext } from '../../constants';
import type { HeadingFolds } from '../../plugins/heading-folds';

/** Control height before touch sizing; the control centers on a heading's first line. */
const CONTROL_SIZE = 24;

// Taps on a control must not move focus out of the editor or drop the
// software keyboard (see keepEditorFocus in TouchSelectionToolbar).
const keepEditorFocus = (event: Event) => event.preventDefault();

/**
 * A chevron in the left gutter of every heading that has something under it.
 * It shows on hover, stays while the section is folded, and is always shown
 * on touch, where there is no hover.
 */
export function HeadingFoldControls(props: {
  editor: LexicalEditor;
  folds: HeadingFolds;
}) {
  const [mount, setMount] = createSignal<HTMLElement>();
  onCleanup(
    props.editor.registerRootListener((root) => {
      setMount(root?.parentElement ?? undefined);
    })
  );
  const touch = isTouchDevice();

  return (
    <Show when={mount()}>
      {(parent) => (
        <Portal mount={parent()}>
          <div
            class="absolute top-0 left-0"
            style={{ 'z-index': MarkdownStackingContext.Accessories }}
            onPointerDown={keepEditorFocus}
            onMouseDown={keepEditorFocus}
          >
            <For each={props.folds.controls}>
              {(control) => {
                const label = () =>
                  control.folded
                    ? t('markdownEditor.expandSection')
                    : t('markdownEditor.collapseSection');
                const shown = () =>
                  control.folded ||
                  touch ||
                  props.folds.hoveredKey() === control.key;
                return (
                  <div
                    class="absolute right-0.5 flex items-center"
                    style={{
                      top: `${control.top}px`,
                      height: `${Math.max(control.lineHeight, CONTROL_SIZE)}px`,
                    }}
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={label()}
                      aria-expanded={!control.folded}
                      tooltip={{ content: label(), shortcut: 'cmd+enter' }}
                      class={cn(
                        'transition-opacity duration-100',
                        shown()
                          ? 'opacity-100'
                          : 'opacity-0 hover:opacity-100 focus-visible:opacity-100'
                      )}
                      onClick={() => props.folds.toggle(control.key)}
                    >
                      <CaretDown
                        class={cn(
                          'size-4 text-ink-extra-muted transition-transform duration-150 motion-reduce:transition-none',
                          control.folded && '-rotate-90'
                        )}
                      />
                    </Button>
                  </div>
                );
              }}
            </For>
          </div>
        </Portal>
      )}
    </Show>
  );
}

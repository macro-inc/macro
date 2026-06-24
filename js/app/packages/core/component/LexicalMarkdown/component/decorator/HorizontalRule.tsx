import type { HorizontalRuleDecoratorProps } from '@lexical-core';
import Trash from '@phosphor/x.svg';
import { debounce } from '@solid-primitives/scheduled';
import { Button } from '@ui';
import { $createNodeSelection, $setSelection } from 'lexical';
import { createSignal, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { removeNodeAndRestoreSelection } from '../../plugins/shared/removeNodeAndRestoreSelection';

export function HorizontalRule(props: HorizontalRuleDecoratorProps) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const selection = () => lexicalWrapper?.selection;
  const editor = () => lexicalWrapper?.editor;

  const [ruleHover, setRuleHover] = createSignal(false);

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const clickRuleHandler = () => {
    const currentEditor = editor();
    if (currentEditor === undefined) return;
    if (isSelectedAsNode()) return;
    currentEditor.update(() => {
      const sel = $createNodeSelection();
      sel.add(props.key);
      $setSelection(sel);
    });
  };

  const deleteRule = () => {
    const currentEditor = editor();
    if (currentEditor === undefined) return;
    removeNodeAndRestoreSelection(currentEditor, props.key);
  };

  const debouncedSetHover = debounce((state: boolean) => {
    setRuleHover(state);
  }, 300);

  return (
    <div
      class="relative my-2 w-full h-10 flex items-center"
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        clickRuleHandler();
      }}
      onMouseEnter={() => {
        debouncedSetHover(true);
      }}
      onMouseLeave={() => {
        debouncedSetHover.clear();
        setRuleHover(false);
      }}
    >
      <div
        class="w-full h-px bg-edge rounded-full"
        classList={{
          'outline-edge outline-4': isSelectedAsNode() || ruleHover(),
        }}
      />

      {(isSelectedAsNode() || ruleHover()) && (
        <div class="absolute h-full top-0 right-2 flex flex-row gap-1 items-center">
          {editor()?.isEditable() && (
            <Button
              class="size-8 p-0 border-0 bg-transparent hover:bg-hover"
              tooltip="Remove"
              on:mousedown={(e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                deleteRule();
              }}
            >
              <Trash class="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

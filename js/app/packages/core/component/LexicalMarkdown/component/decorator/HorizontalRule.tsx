import { IconButton } from '@core/component/IconButton';
import Trash from '@icon/regular/x.svg';
import type { HorizontalRuleDecoratorProps } from '@lexical-core';
import { debounce } from '@solid-primitives/scheduled';
import {
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $setSelection,
} from 'lexical';
import { createSignal, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';

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
    const _editor = editor();
    if (_editor === undefined) return;
    if (isSelectedAsNode()) return;
    _editor.update(() => {
      const sel = $createNodeSelection();
      sel.add(props.key);
      $setSelection(sel);
    });
  };

  const deleteRule = () => {
    const _editor = editor();
    if (_editor === undefined) return;
    _editor.update(() => {
      let node = $getNodeByKey(props.key);
      if (!node) return;
      const nextSibling = node.getNextSibling();
      const prevSibling = node.getPreviousSibling();
      const root = $getRoot();

      node.remove();
      if (nextSibling) {
        nextSibling.selectStart();
      } else if (prevSibling) {
        prevSibling.selectEnd();
      } else {
        root.selectEnd();
      }
    });
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
          'outline-edge/30 outline-4': isSelectedAsNode() || ruleHover(),
        }}
      />

      {/* Add hover overlay similar to the image component */}
      {(isSelectedAsNode() || ruleHover()) && (
        <div class="absolute h-full top-0 right-2 flex flex-row gap-1 items-center">
          {editor()?.isEditable() && (
            <IconButton
              class="m-0"
              theme="clear"
              icon={() => <Trash class="size-4" />}
              tooltip={{ label: 'Remove' }}
              onClick={(e: MouseEvent | KeyboardEvent) => {
                e.preventDefault();
                deleteRule();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

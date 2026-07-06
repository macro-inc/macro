/**
 * @file Floating "convert to table" button shown while hovering a list whose
 * shape reads as a table (top-level items = columns, nested items = rows).
 */
import { $isListNode } from '@lexical/list';
import TableIcon from '@phosphor/grid-four.svg';
import { Button } from '@ui';
import { $getNodeByKey, type LexicalEditor, type NodeKey } from 'lexical';
import { createSignal, onCleanup, Show } from 'solid-js';
import { glueToElement } from '../../directive/glueToElement';
import { autoRegister } from '../../plugins/shared/utils';
import {
  $canConvertListToTable,
  LIST_TO_TABLE_COMMAND,
} from '../../plugins/tables/listToTable';

// Keeps the button mounted while the pointer travels from the list to the
// button, which is a separate portaled element rather than a DOM descendant.
const HIDE_DELAY_MS = 150;

export function ListToTableAccessory(props: {
  floatRef: HTMLElement;
  editor: LexicalEditor;
  nodeKey: NodeKey;
}) {
  const [eligible, setEligible] = createSignal(false);
  const [listHovered, setListHovered] = createSignal(false);
  const [buttonHovered, setButtonHovered] = createSignal(false);

  const checkEligible = () => {
    setEligible(
      props.editor.isEditable() &&
        props.editor.read(() => {
          const node = $getNodeByKey(props.nodeKey);
          return $isListNode(node) && $canConvertListToTable(node);
        })
    );
  };
  checkEligible();
  autoRegister(
    props.editor.registerUpdateListener(checkEligible),
    props.editor.registerEditableListener(checkEligible)
  );

  let hideTimer: number | undefined;
  const onEnter = () => {
    window.clearTimeout(hideTimer);
    setListHovered(true);
  };
  const onLeave = () => {
    hideTimer = window.setTimeout(() => setListHovered(false), HIDE_DELAY_MS);
  };
  props.floatRef.addEventListener('mouseenter', onEnter);
  props.floatRef.addEventListener('mouseleave', onLeave);
  onCleanup(() => {
    window.clearTimeout(hideTimer);
    props.floatRef.removeEventListener('mouseenter', onEnter);
    props.floatRef.removeEventListener('mouseleave', onLeave);
  });

  return (
    <Show when={eligible() && (listHovered() || buttonHovered())}>
      <div
        class="pointer-events-none"
        ref={(el) => {
          glueToElement(el, () => ({
            editor: props.editor,
            element: () => props.floatRef,
          }));
        }}
      >
        <div class="absolute top-0 right-0 pointer-events-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-ink-extra-muted/50"
            tooltip="Convert to table"
            onPointerEnter={() => setButtonHovered(true)}
            onPointerLeave={() => setButtonHovered(false)}
            on:click={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setButtonHovered(false);
              props.editor.dispatchCommand(
                LIST_TO_TABLE_COMMAND,
                props.nodeKey
              );
            }}
          >
            <TableIcon />
          </Button>
        </div>
      </div>
    </Show>
  );
}

import { toast } from '@core/component/Toast/Toast';
import {
  $convertPasteToText,
  $isPasteNode,
  type PasteNodeDecoratorProps,
  type PasteOrigin,
} from '@macro-inc/lexical-core';
import { $createNodeSelection, $getNodeByKey, $setSelection } from 'lexical';
import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../../context/LexicalWrapperContext';
import { removeNodeAndRestoreSelection } from '../../../plugins/shared/removeNodeAndRestoreSelection';

/**
 * Editor plumbing shared by the paste-node decorators: node selection and
 * the copy / convert / delete actions, independent of how the chip looks.
 */
export function usePasteNode(props: PasteNodeDecoratorProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const editor = () => wrapper?.editor;
  const selection = () => wrapper?.selection;

  const origin = (): PasteOrigin => props.origin ?? 'pasted';

  const isEditable = () => editor()?.isEditable() ?? false;

  const isSelectedAsNode = () => {
    const sel = selection();
    if (!sel) return false;
    return sel.type === 'node' && sel.nodeKeys.has(props.key);
  };

  const selectNode = () => {
    const e = editor();
    if (!e?.isEditable()) return;
    e.update(() => {
      const sel = $createNodeSelection();
      sel.add(props.key);
      $setSelection(sel);
    });
  };

  const convertToText = () => {
    editor()?.update(() => {
      const node = $getNodeByKey(props.key);
      if (!$isPasteNode(node)) return false;
      $convertPasteToText(node);
      return true;
    });
  };

  const copyText = () => {
    try {
      navigator.clipboard.writeText(props.content);
      toast.success(`Copied ${origin()} text to clipboard`);
    } catch (e) {
      console.error('Failed to copy pasted text to clipboard', e);
    }
  };

  const deleteNode = () => {
    const currentEditor = editor();
    if (!currentEditor) return;
    removeNodeAndRestoreSelection(currentEditor, props.key, $isPasteNode);
  };

  return {
    origin,
    isEditable,
    isSelectedAsNode,
    selectNode,
    convertToText,
    copyText,
    deleteNode,
  };
}

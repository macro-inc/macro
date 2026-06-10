import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { $getId } from '@lexical-core';
import { mergeRegister } from '@lexical/utils';
import {
  $getNearestNodeFromDOMNode,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { createStore } from 'solid-js/store';

export type HoverTooltipState = {
  hovering: boolean;
  x: number;
  y: number;
  nodeId: string | null;
};

export function createHoverTooltipStore() {
  return createStore<HoverTooltipState>({
    hovering: false,
    x: 0,
    y: 0,
    nodeId: null,
  });
}

type HoverTooltipPluginProps = {
  setState: (state: Partial<HoverTooltipState>) => void;
};

function registerHoverTooltipPlugin(
  editor: LexicalEditor,
  props: HoverTooltipPluginProps
) {
  const handlePointerMove = (e: MouseEvent) => {
    if (isTouchDevice()) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) {
      props.setState({ hovering: false, nodeId: null });
      return;
    }

    // Suppress while the user has a text selection — that's when the
    // formatting popup shows and the tooltip would compete with it.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) {
      props.setState({ hovering: false, nodeId: null });
      return;
    }

    editor.read(() => {
      const node = $getNearestNodeFromDOMNode(target);
      if (!node || !$isTextNode(node)) {
        props.setState({ hovering: false, nodeId: null });
        return;
      }
      // Walk up to the nearest ancestor that has a stable ID.
      let cursor: LexicalNode | null = node;
      let nodeId: string | null = null;
      while (cursor) {
        nodeId = $getId(cursor);
        if (nodeId) break;
        cursor = cursor.getParent();
      }
      props.setState({
        hovering: true,
        x: e.clientX,
        y: e.clientY,
        nodeId,
      });
    });
  };

  const dismiss = () => {
    props.setState({ hovering: false, nodeId: null });
  };

  return mergeRegister(
    editor.registerRootListener((root, prevRoot) => {
      if (root) {
        root.addEventListener('pointermove', handlePointerMove);
        root.addEventListener('pointerleave', dismiss);
        root.addEventListener('pointerdown', dismiss);
      }
      if (prevRoot) {
        prevRoot.removeEventListener('pointermove', handlePointerMove);
        prevRoot.removeEventListener('pointerleave', dismiss);
        prevRoot.removeEventListener('pointerdown', dismiss);
      }
    })
  );
}

export function hoverTooltipPlugin(props: HoverTooltipPluginProps) {
  return (editor: LexicalEditor) => registerHoverTooltipPlugin(editor, props);
}

import {
  $isBookingLinkMentionNode,
  HISTORIC_TAG,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from '@macro-inc/lexical-core';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../context/LexicalWrapperContext';

export interface BookingLinkMentionHost {
  isSelected(key: string): boolean;
  registerNormalEnter(
    listener: (event: KeyboardEvent | null) => boolean
  ): () => void;
  setLabel(key: string, label: string): void;
}

export interface BookingLinkMentionHostProp {
  readonly host?: BookingLinkMentionHost;
}

export function useBookingLinkMentionHost(
  supplied?: BookingLinkMentionHost
): BookingLinkMentionHost | undefined {
  if (supplied) return supplied;
  const wrapper = useContext(LexicalWrapperContext);
  const editor = wrapper?.editor;
  if (!editor) return;
  return {
    isSelected(key) {
      const selection = wrapper?.selection;
      return selection?.type === 'node' && selection.nodeKeys.has(key);
    },
    registerNormalEnter(listener) {
      return editor.registerCommand(
        KEY_ENTER_COMMAND,
        listener,
        COMMAND_PRIORITY_NORMAL
      );
    },
    setLabel(key, label) {
      editor.update(
        () => {
          const node = $getNodeByKey(key);
          if ($isBookingLinkMentionNode(node)) node.setLabel(label);
        },
        {
          tag: [
            HISTORIC_TAG,
            SKIP_DOM_SELECTION_TAG,
            SKIP_SCROLL_INTO_VIEW_TAG,
          ],
          discrete: true,
        }
      );
    },
  };
}

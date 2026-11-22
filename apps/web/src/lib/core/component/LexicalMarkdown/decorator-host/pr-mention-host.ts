import {
  $isPullRequestMentionNode,
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

export interface PullRequestMentionHost {
  isSelected(key: string): boolean;
  previewFetchEnabled(): boolean;
  registerNormalEnter(
    listener: (event: KeyboardEvent | null) => boolean
  ): (() => void) | undefined;
  enrich(key: string, label?: string, url?: string): void;
}

export interface PullRequestMentionHostProp {
  readonly host?: PullRequestMentionHost;
}

export function usePullRequestMentionHost(
  supplied?: PullRequestMentionHost
): PullRequestMentionHost {
  if (supplied) return supplied;
  const wrapper = useContext(LexicalWrapperContext);
  const editor = wrapper?.editor;
  return {
    isSelected(key) {
      const selection = wrapper?.selection;
      return selection?.type === 'node' && selection.nodeKeys.has(key);
    },
    previewFetchEnabled: () => !wrapper?.skipPreviewFetch,
    registerNormalEnter(listener) {
      return editor?.registerCommand(
        KEY_ENTER_COMMAND,
        listener,
        COMMAND_PRIORITY_NORMAL
      );
    },
    enrich(key, label, url) {
      editor?.update(
        () => {
          const node = $getNodeByKey(key);
          if ($isPullRequestMentionNode(node)) {
            if (label) node.setLabel(label);
            if (url) node.setUrl(url);
          }
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

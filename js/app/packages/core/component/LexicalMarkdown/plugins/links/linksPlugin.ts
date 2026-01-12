import {
  $createAutoLinkNode,
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  $toggleLink,
  type AutoLinkNode,
  type LinkNode,
} from '@lexical/link';
import {
  $findMatchingParent,
  $wrapNodeInElement,
  mergeRegister,
} from '@lexical/utils';
import { $createUnlinkedTextNode } from '@lexical-core';
import type { LexicalEditor } from 'lexical';
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  FORMAT_TEXT_COMMAND,
  PASTE_COMMAND,
  TextNode,
} from 'lexical';
import linkify, { type Match } from 'linkify-it';
import { createSignal } from 'solid-js';
import { editorFocusSignal } from '../../utils';

const strictLinkifier = new linkify(undefined, {
  fuzzyLink: false,
});

const fuzzyLinkifier = new linkify(undefined, {
  fuzzyLink: true,
});

/*
 * Basic URL cleaning.
 */
function cleanURL(input: string) {
  let url = input.trim();

  if (!url.match(/^[a-zA-Z]+:\/\//)) {
    url = 'https://' + url;
  }

  const [basePath, ...queryParts] = url.split(/([#?])/);

  const encodedBase = basePath
    .split('/')
    .map((segment) => (segment.includes(':') ? segment : encodeURI(segment)))
    .join('/');

  if (queryParts.length) {
    return encodedBase + queryParts.join('');
  }
  return encodedBase;
}

/**
 * Link information interface between lexical and the UI.
 * @param linkRef The ref for the in-DOM link element. Will be defined if a link already exists
 *     and is being edited.
 * @param selection The selection for the link. Will be defined if a link is being created.
 * @param editAccess Whether the user has editor access on the document
 * @param url The url for the link. Will be undefined if a link is being created.
 * @param linkText The text for the link.
 */
export interface ILinkInfo {
  editAccess: boolean;
  linkRef?: HTMLElement;
  selection?: Selection | null;
  url?: string;
  linkText?: string;
  autoFocus?: boolean;
}

// TODO (seamus): Attach node keys to these commands and generally improve them.
export const UPDATE_LINK_URL_COMMAND = createCommand<string | null>(
  'UPDATE_LINK_URL_COMMAND '
);

export const UPDATE_LINK_COMMAND = createCommand<
  Pick<ILinkInfo, 'linkText' | 'url'>
>('UPDATE_LINK_COMMAND');

export const UNLINK_COMMAND = createCommand<void>('UNLINK_COMMAND');

export const TRY_INSERT_LINK_COMMAND = createCommand<void>(
  'TRY_INSERT_LINK_COMMAND'
);

export const INSERT_LINK_COMMAND = createCommand<{
  url: string;
  linkText: string;
}>('INSERT_LINK_COMMAND');

/**
 * Find an href from a clicked element.
 */
function getLinkFromDom(
  target: EventTarget | null
): { url: string; linkText: string } | null {
  if (!(target instanceof Node) || target.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  const el = target as HTMLElement;
  const parentLink = el.closest('a');
  if (!parentLink || parentLink.classList.contains('internal-link')) {
    return null;
  }
  const url = parentLink.getAttribute('href') || '';
  const linkText = parentLink.textContent || '';
  return {
    url,
    linkText,
  };
}

function findNextMatch(text: string): Match | null {
  if (!strictLinkifier.test(text)) return null;
  const match = strictLinkifier.match(text);
  if (!match) return null;
  return match[0];
}

function $handleAppendToMatch(prevSibling: AutoLinkNode, textNode: TextNode) {
  const prevText = prevSibling.getTextContent();
  const nodeText = textNode.getTextContent();

  if (prevSibling.getIsUnlinked()) return;

  if (nodeText.includes(' ')) {
    $convertAutoLinkToLinkNode(prevSibling);
    return;
  }

  const combinedText = prevText + nodeText;
  const rematch = findNextMatch(combinedText);

  if (!rematch) {
    return;
  }

  if (prevSibling.getTextContent().includes(rematch.text)) {
    return;
  }

  const prevLinkTextNode = prevSibling.getFirstChild();

  if (!$isTextNode(prevLinkTextNode) || !prevLinkTextNode.isSimpleText()) {
    return;
  }

  // append to the autolink node, and shift chars from the text node for each aggregate match
  const numCharsToShift = rematch.raw.length - prevText.length;
  textNode.setTextContent(nodeText.substring(numCharsToShift));
  prevLinkTextNode.setTextContent(rematch.text);
  prevSibling.setURL(rematch.url);
}

function $matchAndCreateAutoLink(textNode: TextNode) {
  const nodeText = textNode.getTextContent();
  const matchedLink = findNextMatch(nodeText);
  let currentNode = textNode;

  if (!matchedLink) {
    return;
  }

  const matchOffset = matchedLink.index;
  const matchLength = matchedLink.raw.length;
  let matchedNode;

  if (matchOffset === 0) {
    [matchedNode, currentNode] = currentNode.splitText(matchLength);
  } else {
    [, matchedNode, currentNode] = currentNode.splitText(
      matchOffset,
      matchOffset + matchLength
    );
  }

  const linkNode = $createAutoLinkNode(matchedLink.url);
  linkNode.append($createTextNode(matchedLink.text));
  matchedNode.replace(linkNode);
}

function $convertAutoLinkToLinkNode(node: AutoLinkNode): LinkNode {
  const url = node.getURL();
  const text = node.getTextContent();
  const linkNode = $createLinkNode(url);
  linkNode.append($createTextNode(text));
  node.replace(linkNode);
  linkNode.selectEnd();
  return linkNode;
}

// TODO (seamus): Improve this logic. This function should correctly dissolve any links that
// are touched by the selection while maintaining all children and text formatting.
function $unlinkSelection(): boolean {
  const selection = $getSelection();
  let unlinkSuccess = false;
  if (!$isRangeSelection(selection)) return false;

  const nodes = selection.getNodes();
  if (nodes.length === 0) return false;

  const anchor = {
    key: selection.anchor.key,
    offset: selection.anchor.offset,
  };

  const focus = {
    key: selection.focus.key,
    offset: selection.focus.offset,
  };

  // Process all selected nodes
  nodes.forEach((node) => {
    const parent = node.getParent();
    if (!node || !parent) return;

    if ($isAutoLinkNode(parent)) {
      parent.setIsUnlinked(true);
      parent.markDirty();
      unlinkSuccess = true;
      return;
    }

    if ($isLinkNode(parent)) {
      unlinkSuccess = true;
      let newNode;
      let text = node.getTextContent();
      if (strictLinkifier.test(text)) {
        newNode = $createUnlinkedTextNode(text);
      } else {
        newNode = $createTextNode(text);
      }
      if (node.getKey() === anchor.key) {
        anchor.key = newNode.getKey();
      }
      if (node.getKey() === focus.key) {
        focus.key = newNode.getKey();
      }
      parent.replace(newNode);
    }
  });

  if (!unlinkSuccess) return false;
  const nextSelection = $getSelection();
  if (!$isRangeSelection(nextSelection)) return false;

  nextSelection.anchor.set(anchor.key, anchor.offset, 'text');
  nextSelection.focus.set(focus.key, focus.offset, 'text');
  $setSelection(nextSelection);

  return true;
}

function $getLinkInsertType(): 'collapsed' | 'expanded' | 'none' {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return 'none';
  if (selection.isCollapsed()) return 'collapsed';
  return 'expanded';
}

function $tryInsertLink(
  editor: LexicalEditor,
  url?: string,
  onCreate?: (info: ILinkInfo | null) => void,
  onEdit?: (info: ILinkInfo | null) => void
) {
  const insertType = $getLinkInsertType();
  if (insertType === 'none') return false;

  let selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }

  const focus = selection.focus.getNode();
  const elem = editor.getElementByKey(focus.getKey());

  if (!elem) {
    return false;
  }

  if (document.activeElement !== editor.getRootElement()) {
    return false;
  }

  if (insertType === 'collapsed' && onCreate) {
    onCreate({
      selection: window.getSelection(),
      editAccess: true,
      url,
      autoFocus: true,
    });
    return true;
  } else if (insertType === 'expanded' && onEdit) {
    const text = $getSelection()?.getTextContent() ?? '';
    $toggleLink(url ?? '');
    let selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return false;
    }
    const focus = selection.focus.getNode();
    const key = focus.getKey();
    setTimeout(() => {
      onEdit({
        editAccess: true,
        linkRef: editor.getElementByKey(key) ?? undefined,
        url,
        linkText: text,
        autoFocus: true,
      });
    });

    return true;
  }
}

export type LinkPluginProps = {
  onHoverLink?: (link?: ILinkInfo) => void;
  onClickLink?: (link?: ILinkInfo) => void;
  onCreateLink?: (link?: ILinkInfo) => void;
  closePopup?: () => void;
};

function registerLinksPlugin(editor: LexicalEditor, props: LinkPluginProps) {
  const { onHoverLink, onClickLink, onCreateLink } = {
    onHoverLink: () => {},
    onClickLink: () => {},
    onCreateLink: () => {},
    ...props,
  };

  const [_editorFocus, setEditorFocus] = createSignal(false);

  let hoveredLink: ILinkInfo | undefined;

  const handleClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const link = getLinkFromDom(el);
    if (link === null) return;
    if (e.metaKey || e.ctrlKey) {
      window.open(link.url);
    }

    if (editor.isEditable()) {
      onClickLink({
        linkRef: el,
        selection: window.getSelection() || undefined,
        editAccess: editor.isEditable(),
        ...link,
      });
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    window.open(link.url, '_blank');
  };

  const handlePointerMove = (e: MouseEvent) => {
    const target = e.target;
    const link = getLinkFromDom(target);
    if (link === null) {
      onHoverLink(undefined);
      hoveredLink = undefined;
      return;
    }
    const el = target as HTMLElement;
    if (hoveredLink === undefined || el !== hoveredLink.linkRef) {
      const newHoveredLink: ILinkInfo = {
        linkRef: el,
        ...link,
        editAccess: editor.isEditable(),
      };
      hoveredLink = newHoveredLink;
      onHoverLink(newHoveredLink);
    }
  };

  const handlePointerLeave = () => {
    hoveredLink = undefined;
    onHoverLink(undefined);
  };

  return mergeRegister(
    editorFocusSignal(editor, setEditorFocus),

    editor.registerRootListener((root, prevRoot) => {
      if (root) {
        root.addEventListener('click', handleClick);
        root.addEventListener('pointermove', handlePointerMove);
        root.addEventListener('pointerleave', handlePointerLeave);
      }
      if (prevRoot) {
        prevRoot.removeEventListener('click', handleClick);
        prevRoot.removeEventListener('pointermove', handlePointerMove);
        prevRoot.removeEventListener('pointerleave', handlePointerLeave);
      }
    }),

    editor.registerNodeTransform(TextNode, (textNode: TextNode) => {
      const parent = textNode.getParentOrThrow();
      const prevSibling = textNode.getPreviousSibling();

      if (!textNode.isSimpleText() || $isAutoLinkNode(parent)) {
        return;
      }
      if (textNode.hasFormat('code')) {
        return;
      }

      // Avoid autolinking when any ancestor is already a link
      const insideAnyLink =
        $findMatchingParent(
          textNode,
          (n) => $isLinkNode(n) || $isAutoLinkNode(n)
        ) !== null;
      if (insideAnyLink) {
        return;
      }

      if (prevSibling && $isAutoLinkNode(prevSibling)) {
        $handleAppendToMatch(prevSibling, textNode);
      }

      if (!insideAnyLink) {
        $matchAndCreateAutoLink(textNode);
      }
    }),

    editor.registerCommand(
      UNLINK_COMMAND,
      () => {
        $unlinkSelection();
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      PASTE_COMMAND,
      (e) => {
        if (!(e instanceof ClipboardEvent)) return false;
        const clipboardText = e.clipboardData?.getData('text/plain');
        if (!clipboardText || !strictLinkifier.matchAtStart(clipboardText))
          return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selection.isCollapsed())
          return false;
        $toggleLink(clipboardText);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    // Dissolve links inside of code blocks
    editor.registerCommand(
      FORMAT_TEXT_COMMAND,
      (format) => {
        if (format === 'code') {
          $unlinkSelection();
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      UPDATE_LINK_URL_COMMAND,
      (payload) => {
        if (payload === null) return false;
        if (!fuzzyLinkifier.test(payload)) return false;
        const url = cleanURL(payload);

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        let didUpdate = false;
        const nodes = selection.getNodes();
        nodes.forEach((node) => {
          const parent = node.getParent();
          if ($isAutoLinkNode(parent) || $isLinkNode(parent)) {
            didUpdate = true;
            parent.setURL(url);
          }
        });

        return didUpdate;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      UPDATE_LINK_COMMAND,
      (payload) => {
        if (payload.url === undefined || payload.linkText === undefined) {
          return false;
        }
        const url = cleanURL(payload.url);
        if (!strictLinkifier.test(url)) {
          return false;
        }

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        let parentLinkNodes = new Set<LinkNode>();
        const nodes = selection.getNodes();
        nodes.forEach((node) => {
          const parent = node.getParent();
          if ($isAutoLinkNode(parent) || $isLinkNode(parent)) {
            parentLinkNodes.add(parent);
          }
        });
        if (parentLinkNodes.size === 0) return false;

        for (const linkNode of parentLinkNodes) {
          linkNode.setURL(url);
          const newLink = $createLinkNode(url);
          newLink.append($createTextNode(payload.linkText));
          linkNode.replace(newLink);
          newLink.selectEnd();
        }

        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      TRY_INSERT_LINK_COMMAND,
      () => {
        $tryInsertLink(
          editor,
          '',
          (info) => {
            info && onCreateLink(info);
          },
          (info) => {
            info && onClickLink(info);
          }
        );
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      INSERT_LINK_COMMAND,
      (payload) => {
        const url = cleanURL(payload.url);
        const linkNode = $createLinkNode(url);
        linkNode.append($createTextNode(payload.linkText));
        $insertNodes([linkNode]);
        if ($isRootOrShadowRoot(linkNode.getParentOrThrow())) {
          $wrapNodeInElement(linkNode, $createParagraphNode).selectEnd();
        }
        editor.update(() => {
          linkNode.selectEnd();
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

/**
 * The links plugin registers the listeners for links, whith an optional
 * callback for hovering over a link.
 */
export function linksPlugin(props: LinkPluginProps) {
  return (editor: LexicalEditor) => {
    return registerLinksPlugin(editor, props);
  };
}

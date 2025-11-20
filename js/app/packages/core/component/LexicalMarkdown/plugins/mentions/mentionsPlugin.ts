import { verifyBlockName } from '@core/constant/allBlocks';
import { untrackMention } from '@core/signal/mention';
import { $wrapNodeInElement, mergeRegister } from '@lexical/utils';
import type { PeerIdValidator } from '@lexical-core';
import {
  $collapseInlineSearch,
  $createContactMentionNode,
  $createDateMentionNode,
  $createDocumentMentionNode,
  $createInlineSearchNode,
  $createUserMentionNode,
  $handleInlineSearchNodeMutation,
  $handleInlineSearchNodeTransform,
  $isContactMentionNode,
  $isDateMentionNode,
  $isDocumentMentionNode,
  $isUserMentionNode,
  $removeInlineSearch,
  type ContactMentionInfo,
  ContactMentionNode,
  type DateMentionInfo,
  DateMentionNode,
  type DocumentMentionInfo,
  DocumentMentionNode,
  InlineSearchNode,
  InlineSearchNodesType,
  type UserMentionInfo,
  UserMentionNode,
  validTriggerPosition,
} from '@lexical-core';
import { $getId } from '@lexical-core/plugins/nodeIdPlugin';
import type { MentionNode } from '@lexical-core/utils/mentions';
import { blockNameToItemType } from '@service-storage/client';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isNodeSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type { Setter } from 'solid-js';
import type { MenuOperations } from '../../shared/inlineMenu';
import { $collapseSelection, $traverseNodes, nodeByKey } from '../../utils';
import { mapRegisterDelete } from '../shared';

export const INSERT_DOCUMENT_MENTION_COMMAND: LexicalCommand<DocumentMentionInfo> =
  createCommand('INSERT_DOCUMENT_MENTION_COMMAND');

export const INSERT_CONTACT_MENTION_COMMAND: LexicalCommand<ContactMentionInfo> =
  createCommand('INSERT_CONTACT_MENTION_COMMAND');

export const INSERT_DATE_MENTION_COMMAND: LexicalCommand<DateMentionInfo> =
  createCommand('INSERT_DATE_MENTION_COMMAND');

export const OPEN_INLINE_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'OPEN_INLINE_SEARCH_COMMAND'
);

export const CLOSE_INLINE_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_INLINE_SEARCH_COMMAND'
);

export const TYPE_AT_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'TYPE_AT_SYMBOL_COMMAND'
);

export const REMOVE_INLINE_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'REMOVE_INLINE_SEARCH_COMMAND'
);

export const UPDATE_DOCUMENT_NAME_COMMAND: LexicalCommand<
  Record<string, string>
> = createCommand('UPDATE_DOCUMENT_NAME_COMMAND');

export const INSERT_USER_MENTION_COMMAND: LexicalCommand<UserMentionInfo> =
  createCommand('INSERT_USER_MENTION_COMMAND');

export type ItemMention = {
  itemType:
    | 'document'
    | 'chat'
    | 'user'
    | 'channel'
    | 'project'
    | 'rss'
    | 'contact'
    | 'date'
    | 'email'
    | 'unknown'
    | 'color';
  itemId: string;
  fileType?: string;
  documentName?: string;
  channelType?: string;
};

export function $isMentionNode(
  node: LexicalNode
): node is
  | UserMentionNode
  | DocumentMentionNode
  | ContactMentionNode
  | DateMentionNode {
  return (
    $isUserMentionNode(node) ||
    $isDocumentMentionNode(node) ||
    $isContactMentionNode(node) ||
    $isDateMentionNode(node)
  );
}
export function $mentionItemFromNode(node: MentionNode): ItemMention {
  if ($isDocumentMentionNode(node)) {
    let fileType = '';
    let itemType: ItemMention['itemType'] = 'document';
    const documentName = node.getDocumentName();
    const blockName = node.getBlockName();
    if (blockName === 'pdf') fileType = 'pdf';
    else if (blockName === 'write') fileType = 'docx';
    else if (blockName === 'md') fileType = 'md';
    else if (blockName === 'canvas') fileType = 'canvas';
    else if (blockName === 'code') {
      const blockParams = node.getBlockParams();
      fileType = blockParams?.fileType || 'txt';
    } else if (blockName === 'image') {
      fileType = 'png'; // Default to png
    } else if (blockName === 'channel') {
      fileType = 'channel';
      itemType = 'channel';
    } else if (blockName === 'project') {
      fileType = 'project';
      itemType = 'project';
    } else if (blockName === 'rss') {
      fileType = 'rss';
    } else if (blockName === 'email') {
      fileType = 'email';
      itemType = 'email';
    } else if (blockName === 'unknown') {
      fileType = 'unknown';
    }
    return {
      itemType: itemType,
      itemId: node.getDocumentId(),
      fileType,
      documentName,
      channelType: node.getChannelType(),
    };
  } else if ($isUserMentionNode(node)) {
    return {
      itemType: 'user',
      itemId: node.getUserId(),
    };
  } else if ($isContactMentionNode(node)) {
    return {
      itemType: 'contact',
      itemId: node.getContactId(),
    };
  } else {
    return {
      itemType: 'date',
      itemId: node.getDate(),
    };
  }
}

// Validators for the position of the @ trigger.
const beforeRegex = /[(['"\`\s]$/;
const afterRegex = /^[)\]'"\`\s]/;

/**
 * When mentions nodes are selected by using the arrow keys, we want to be able to delete them.
 * @return true if any nodes to delete were found.
 */
function $deleteSelectedMentions(sourceDocumentId?: string) {
  let foundNodesToBeDeleted = false;

  const sel = $getSelection();
  if (!$isNodeSelection(sel)) return false;
  const nodes = sel.getNodes();
  for (const node of nodes) {
    if ($isMentionNode(node) && node.isKeyboardSelectable()) {
      const mentionUuid = node.getMentionUuid();
      if (mentionUuid && sourceDocumentId) {
        untrackMention(sourceDocumentId, mentionUuid);
      }
      node.remove();
      foundNodesToBeDeleted = true;
    }
  }
  return foundNodesToBeDeleted;
}

const getDocumentMentionItemType = (
  node: DocumentMentionNode
): ItemMention['itemType'] => {
  const blockName = node.__blockName;
  const itemType = blockNameToItemType(verifyBlockName(blockName));
  switch (itemType) {
    case 'document':
    case 'chat':
    case 'channel':
    case 'project':
    case 'email':
      return itemType;
    default:
      console.error(`Invalid item type: ${itemType} for document mention node`);
      return 'document';
  }
};

export type MentionsPluginProps = {
  menu?: MenuOperations;
  onCreateMention?: (mention: ItemMention) => void;
  onRemoveMention?: (mention: ItemMention) => void;
  setMentions?: Setter<ItemMention[]>;
  peerIdValidator?: PeerIdValidator;
  sourceDocumentId?: string;
  disableMentionTracking?: boolean;
};

/**
 * The documentMentionPlugin registers the listeners for the mentions.
 * @param editor the Lexical editor to register the plugin with.
 * @param setDecorators The store setter for decorators.
 * @param openMenu The function to trigger when the @-menu is opened.
 */
function registerMentionsPlugin(
  editor: LexicalEditor,
  props: MentionsPluginProps
) {
  if (
    !editor.hasNodes([
      DocumentMentionNode,
      UserMentionNode,
      ContactMentionNode,
      DateMentionNode,
      InlineSearchNode,
    ])
  ) {
    throw new Error('MentionsPlugin: Editor config is missing required nodes.');
  }

  const { menu, onCreateMention, onRemoveMention, sourceDocumentId } = props;

  /**
   * There is a Lexical bug(?) where keyboard deleting a node selection does not prevent the delete
   * from bubbling to the regular delete commands. This flag gets set to true when we
   * delete a mention viq a node selection.
   */
  let consumeDelete = false;

  /**
   * Register a manual DOM listener for the @ symbol.
   * TODO (seamus) : Find a more Lexical-y way to do this.
   */
  function registerSymbolListener() {
    const listener = (e: KeyboardEvent) => {
      if (e.key === '@') {
        editor.dispatchCommand(TYPE_AT_SYMBOL_COMMAND, undefined);
      }
    };

    return editor.registerRootListener((root, prev) => {
      if (root) {
        root.addEventListener('keydown', listener);
      }
      if (prev) {
        prev.removeEventListener('keydown', listener);
      }
    });
  }

  function updateMentionsSignal() {
    if (props.setMentions === undefined) return;
    const mentions: ItemMention[] = [];
    editor.read(() => {
      $traverseNodes($getRoot(), (node) => {
        if ($isMentionNode(node)) {
          mentions.push($mentionItemFromNode(node));
        }
      });
    });
    props.setMentions(mentions);
  }

  return mergeRegister(
    editor.registerCommand(
      INSERT_DOCUMENT_MENTION_COMMAND,
      (payload) => {
        editor.update(() => {
          const selection = $getSelection();
          const mentionNode = $createDocumentMentionNode(payload);

          if (payload.mentionUuid) {
            mentionNode.setMentionUuid(payload.mentionUuid);
          }

          // Do not paste mentions over range-selected text -- append after.
          if ($isRangeSelection(selection) && !selection.isCollapsed()) {
            $collapseSelection(selection);
            $insertNodes([$createTextNode(' '), mentionNode]);
            mentionNode.selectEnd();
            return true;
          }
          $insertNodes([mentionNode]);
          if ($isRootOrShadowRoot(mentionNode.getParentOrThrow())) {
            $wrapNodeInElement(mentionNode, $createParagraphNode);
          }
          mentionNode.selectEnd();
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      INSERT_USER_MENTION_COMMAND,
      (payload) => {
        editor.update(() => {
          const mentionNode = $createUserMentionNode(payload);

          if (payload.mentionUuid) {
            mentionNode.setMentionUuid(payload.mentionUuid);
          }

          $insertNodes([mentionNode]);
          if ($isRootOrShadowRoot(mentionNode.getParentOrThrow())) {
            $wrapNodeInElement(mentionNode, $createParagraphNode);
          }
          mentionNode.selectEnd();
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      INSERT_CONTACT_MENTION_COMMAND,
      (payload) => {
        editor.update(() => {
          const mentionNode = $createContactMentionNode(payload);

          if (payload.mentionUuid) {
            mentionNode.setMentionUuid(payload.mentionUuid);
          }

          $insertNodes([mentionNode]);
          if ($isRootOrShadowRoot(mentionNode.getParentOrThrow())) {
            $wrapNodeInElement(mentionNode, $createParagraphNode);
          }
          mentionNode.selectEnd();
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      INSERT_DATE_MENTION_COMMAND,
      (payload) => {
        editor.update(() => {
          const mentionNode = $createDateMentionNode(payload);

          if (payload.mentionUuid) {
            mentionNode.setMentionUuid(payload.mentionUuid);
          }

          $insertNodes([mentionNode]);
          if ($isRootOrShadowRoot(mentionNode.getParentOrThrow())) {
            $wrapNodeInElement(mentionNode, $createParagraphNode);
          }
          mentionNode.selectEnd();
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    registerSymbolListener(),

    editor.registerCommand(
      TYPE_AT_SYMBOL_COMMAND,
      () => {
        const shouldTrigger = validTriggerPosition(
          editor,
          beforeRegex,
          afterRegex
        );
        if (shouldTrigger) {
          editor.update(() => {
            $insertNodes([$createInlineSearchNode('@')]);
          });
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerNodeTransform(InlineSearchNode, (node: InlineSearchNode) =>
      $handleInlineSearchNodeTransform(node, InlineSearchNodesType.Mentions)
    ),

    editor.registerCommand(
      CLOSE_INLINE_SEARCH_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),

    editor.registerCommand(
      REMOVE_INLINE_SEARCH_COMMAND,
      () => $removeInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),

    // Menu ENTERS should not propagate to the editor.
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => menu?.isOpen() ?? false,
      COMMAND_PRIORITY_CRITICAL
    ),

    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        consumeDelete = $deleteSelectedMentions(sourceDocumentId);
        return consumeDelete;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      KEY_DELETE_COMMAND,
      () => {
        consumeDelete = $deleteSelectedMentions(sourceDocumentId);
        return consumeDelete;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    mapRegisterDelete(
      editor,
      () => {
        if (consumeDelete) {
          consumeDelete = false;
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      UPDATE_DOCUMENT_NAME_COMMAND,
      (payload) => {
        editor.update(
          () => {
            const nodesToUpdate: DocumentMentionNode[] = [];
            $traverseNodes($getRoot(), (node) => {
              if (
                node instanceof DocumentMentionNode &&
                payload[node.getDocumentId()] &&
                node.getDocumentName() !== payload[node.getDocumentId()]
              ) {
                nodesToUpdate.push(node);
              }
            });

            nodesToUpdate.forEach((node) => {
              const newName = payload[node.getDocumentId()];
              node.setDocumentName(newName);
            });
          },
          {
            // Because these changes come the the "air" (ie the network) we want to make sure
            // they don't get recorded into the undo stack. This was breaking the predictability
            // of undo with document mentions. This hacks around that by using the an undocumented
            // "historic" tag from the LexicalHistoryPlugin.
            tag: 'historic',
            discrete: true,
          }
        );

        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerMutationListener(
      InlineSearchNode,
      (mutatedNodes, { prevEditorState }) =>
        $handleInlineSearchNodeMutation(
          editor,
          prevEditorState,
          mutatedNodes,
          InlineSearchNodesType.Mentions,
          {
            onDestroy: () => menu?.closeMenu(),
            onCreate: () => menu?.openMenu(),
            onUpdate: (search) => menu?.setSearchTerm(search),
          },
          props.peerIdValidator
        )
    ),

    editor.registerMutationListener(
      DocumentMentionNode,
      (mutatedNodes, { prevEditorState }) => {
        for (const [nodeKey, mutation] of mutatedNodes) {
          const node = nodeByKey(
            editor.getEditorState(),
            nodeKey
          ) as DocumentMentionNode | null;

          if (!node) {
            continue;
          }

          const itemType = getDocumentMentionItemType(node);
          if (mutation === 'destroyed') {
            const nodeId = prevEditorState.read(() => $getId(node));
            if (nodeId) {
              // unsetDocumenentionPreviewCache(nodeId);
            }
            const mentionUuid = node.getMentionUuid();
            if (mentionUuid && sourceDocumentId) {
              untrackMention(sourceDocumentId, mentionUuid);
            }
            if (onRemoveMention) {
              onRemoveMention({
                itemType,
                itemId: node.getDocumentId(),
              });
            }
          } else if (mutation === 'created') {
            if (onCreateMention) {
              let fileType = '';
              const documentName = node.getDocumentName();
              const blockName = node.getBlockName();
              if (blockName === 'pdf') fileType = 'pdf';
              else if (blockName === 'write') fileType = 'docx';
              else if (blockName === 'md') fileType = 'md';
              else if (blockName === 'canvas') fileType = 'canvas';
              else if (blockName === 'code') {
                const blockParams = node.getBlockParams();
                fileType = blockParams?.fileType || 'txt';
              } else if (blockName === 'image') {
                fileType = 'png'; // Default to png
              } else if (blockName === 'channel') {
                fileType = 'channel';
              } else if (blockName === 'project') {
                fileType = 'project';
              } else if (blockName === 'rss') {
                fileType = 'rss';
              } else if (blockName === 'email') {
                fileType = 'email';
              } else if (blockName === 'unknown') {
                fileType = 'unknown';
              }
              onCreateMention({
                itemType: blockName === 'email' ? 'email' : itemType,
                itemId: node.getDocumentId(),
                fileType,
                documentName,
                channelType: node.getChannelType(),
              });
            }
          }
        }
        updateMentionsSignal();
      }
    ),

    editor.registerMutationListener(
      UserMentionNode,
      (mutatedNodes, { prevEditorState }) => {
        for (const [nodeKey, mutation] of mutatedNodes) {
          const node = nodeByKey(prevEditorState, nodeKey) as UserMentionNode;
          if (node && mutation === 'destroyed') {
            const mentionUuid = node.getMentionUuid();
            if (mentionUuid && sourceDocumentId) {
              untrackMention(sourceDocumentId, mentionUuid);
            }
            if (onRemoveMention) {
              onRemoveMention({
                itemType: 'user',
                itemId: node.getUserId(),
              });
            }
          }
          if (node && mutation === 'created') {
            if (onCreateMention) {
              onCreateMention({
                itemType: 'user',
                itemId: node.getUserId(),
              });
            }
          }
        }
        updateMentionsSignal();
      }
    ),

    editor.registerMutationListener(
      ContactMentionNode,
      (mutatedNodes, { prevEditorState }) => {
        for (const [nodeKey, mutation] of mutatedNodes) {
          const node = nodeByKey(
            prevEditorState,
            nodeKey
          ) as ContactMentionNode;
          if (node && mutation === 'destroyed') {
            const mentionUuid = node.getMentionUuid();
            if (mentionUuid && sourceDocumentId) {
              untrackMention(sourceDocumentId, mentionUuid);
            }
            if (onRemoveMention) {
              onRemoveMention({
                itemType: 'contact',
                itemId: node.getContactId(),
              });
            }
          }
          if (node && mutation === 'created') {
            if (onCreateMention) {
              onCreateMention({
                itemType: 'contact',
                itemId: node.getContactId(),
              });
            }
          }
        }
        updateMentionsSignal();
      }
    ),

    editor.registerMutationListener(
      DateMentionNode,
      (mutatedNodes, { prevEditorState }) => {
        for (const [nodeKey, mutation] of mutatedNodes) {
          const node = nodeByKey(prevEditorState, nodeKey) as DateMentionNode;
          if (node && mutation === 'destroyed') {
            const mentionUuid = node.getMentionUuid();
            if (mentionUuid && sourceDocumentId) {
              untrackMention(sourceDocumentId, mentionUuid);
            }
            if (onRemoveMention) {
              onRemoveMention({
                itemType: 'date',
                itemId: node.getDate(),
              });
            }
          }
          if (node && mutation === 'created') {
            if (onCreateMention) {
              onCreateMention({
                itemType: 'date',
                itemId: node.getDate(),
              });
            }
          }
        }
        updateMentionsSignal();
      }
    )
  );
}

export function mentionsPlugin(props: MentionsPluginProps) {
  return (editor: LexicalEditor) => registerMentionsPlugin(editor, props);
}

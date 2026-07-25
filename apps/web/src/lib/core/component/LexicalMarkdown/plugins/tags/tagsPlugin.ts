import { $wrapNodeInElement, mergeRegister } from '@lexical/utils';
import {
  $collapseInlineSearch,
  $createInlineSearchNode,
  $createTagMentionNode,
  $handleInlineSearchNodeMutation,
  $handleInlineSearchNodeTransform,
  $isTagMentionNode,
  $removeInlineSearch,
  InlineSearchNode,
  InlineSearchNodesType,
  type PeerIdValidator,
  type TagMentionInfo,
  TagMentionNode,
  validTriggerPosition,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';
import type { MenuOperations } from '../../shared/inlineMenu';
import { $collapseSelection, $traverseNodes, nodeByKey } from '../../utils';
import {
  CLOSE_INLINE_SEARCH_COMMAND,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../mentions/mentionsPlugin';

export const INSERT_TAG_MENTION_COMMAND: LexicalCommand<TagMentionInfo> =
  createCommand('INSERT_TAG_MENTION_COMMAND');

const TYPE_HASH_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'TYPE_HASH_SYMBOL_COMMAND'
);

export type TagMentionLifecycle = TagMentionInfo;

type TagsPluginProps = {
  menu?: MenuOperations;
  insertTags?: boolean;
  onCreateTag?: (tag: TagMentionLifecycle) => void;
  onRemoveTag?: (tag: TagMentionLifecycle) => void;
  setTags?: (tags: ReadonlySet<TagMentionLifecycle>) => void;
  peerIdValidator?: PeerIdValidator;
};

const beforeRegex = /[(['"`\s]$/;
const afterRegex = /^[)\]'"`\s]/;

function tagMentionFromNode(node: TagMentionNode): TagMentionLifecycle {
  return {
    optionId: node.getOptionId(),
    propertyDefinitionId: node.getPropertyDefinitionId(),
    scope: node.getScope(),
    name: node.getName(),
    color: node.getColor(),
  };
}

function registerHashSymbolListener(
  editor: LexicalEditor,
  props: TagsPluginProps
) {
  const listener = (e: KeyboardEvent) => {
    if (e.key === '#') {
      if (props.menu?.isOpen()) {
        editor.update(() => {
          $collapseInlineSearch(props.peerIdValidator);
        });
        props.menu.closeMenu();
        return;
      }
      editor.dispatchCommand(TYPE_HASH_SYMBOL_COMMAND, undefined);
    }
  };

  return editor.registerRootListener((root, prev) => {
    if (root) root.addEventListener('keydown', listener);
    if (prev) prev.removeEventListener('keydown', listener);
  });
}

function registerTagsPlugin(editor: LexicalEditor, props: TagsPluginProps) {
  if (!editor.hasNode(InlineSearchNode)) {
    throw new Error('TagsPlugin: Editor config is missing InlineSearchNode.');
  }

  const insertTags = props.insertTags ?? true;
  if (insertTags && !editor.hasNode(TagMentionNode)) {
    throw new Error('TagsPlugin: Editor config is missing TagMentionNode.');
  }

  const updateTagsSignal = () => {
    if (props.setTags === undefined) return;
    const tags = new Map<string, TagMentionLifecycle>();
    editor.read(() => {
      $traverseNodes($getRoot(), (node) => {
        if ($isTagMentionNode(node)) {
          const tag = tagMentionFromNode(node);
          tags.set(tag.optionId, tag);
        }
      });
    });
    props.setTags(new Set(tags.values()));
  };

  return mergeRegister(
    editor.registerCommand(
      INSERT_TAG_MENTION_COMMAND,
      (payload) => {
        if (!insertTags) {
          editor.update(() => {
            $removeInlineSearch(props.peerIdValidator);
          });
          props.onCreateTag?.(payload);
          return true;
        }

        editor.update(() => {
          const selection = $getSelection();
          const mentionNode = $createTagMentionNode(payload);

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

    registerHashSymbolListener(editor, props),

    editor.registerCommand(
      TYPE_HASH_SYMBOL_COMMAND,
      () => {
        const shouldTrigger = validTriggerPosition(
          editor,
          beforeRegex,
          afterRegex
        );
        if (!shouldTrigger) return false;

        editor.update(() => {
          $insertNodes([$createInlineSearchNode('#')]);
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerNodeTransform(InlineSearchNode, (node: InlineSearchNode) =>
      $handleInlineSearchNodeTransform(node, InlineSearchNodesType.Tags)
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

    editor.registerMutationListener(
      InlineSearchNode,
      (mutatedNodes, { prevEditorState }) =>
        $handleInlineSearchNodeMutation(
          editor,
          prevEditorState,
          mutatedNodes,
          InlineSearchNodesType.Tags,
          {
            onDestroy: () => props.menu?.closeMenu(),
            onCreate: () => props.menu?.openMenu(),
            onUpdate: (search) => props.menu?.setSearchTerm(search),
          },
          props.peerIdValidator
        )
    ),

    ...(insertTags
      ? [
          editor.registerMutationListener(
            TagMentionNode,
            (mutatedNodes, { prevEditorState }) => {
              for (const [nodeKey, mutation] of mutatedNodes) {
                const node = nodeByKey(
                  mutation === 'destroyed'
                    ? prevEditorState
                    : editor.getEditorState(),
                  nodeKey
                ) as TagMentionNode | null;
                if (!node) continue;

                const tag = tagMentionFromNode(node);
                if (mutation === 'created') props.onCreateTag?.(tag);
                if (mutation === 'destroyed') props.onRemoveTag?.(tag);
              }
              updateTagsSignal();
            }
          ),
        ]
      : [])
  );
}

export function tagsPlugin(props: TagsPluginProps) {
  return (editor: LexicalEditor) => registerTagsPlugin(editor, props);
}

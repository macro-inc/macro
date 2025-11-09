import type { createBlockSignal } from '@core/block';
import { $wrapNodeInElement, mergeRegister } from '@lexical/utils';
import type { NodeIdMappings } from '@lexical-core';
import {
  $createDiffDeleteNode,
  $createDiffInsertNode,
  $createDiffNode,
  $diffNodeDeleteAtStart,
  $getNodeById,
  $isDiffNode,
} from '@lexical-core';
import type { MarkdownRewriteOutput } from '@service-cognition/generated/tools/types';
import { useUserId } from '@service-gql/client';
import type { LexicalEditor } from 'lexical';
import {
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
} from 'lexical';
import { createEffect } from 'solid-js';
import { mapRegisterDelete } from '../shared/utils';

type Diff = MarkdownRewriteOutput['diffs'][number];

export type DiffPluginArgs = {
  revisionsSignal: ReturnType<typeof createBlockSignal<Diff[] | undefined>>;
  nodeIdMap: NodeIdMappings;
};

type DiffPayload = {
  key: string;
  markdownText: string;
};

const INSERT_BEFORE_DIFF_COMMAND = createCommand<DiffPayload>(
  'INSERT_BEFORE_DIFF_COMMAND'
);

const INSERT_AFTER_DIFF_COMMAND = createCommand<DiffPayload>(
  'INSERT_AFTER_DIFF_COMMAND'
);

const MODIFY_DIFF_COMMAND = createCommand<DiffPayload>('MODIFY_DIFF_COMMAND');

const DELETE_DIFF_COMMAND = createCommand<string>('DELETE_DIFF_COMMAND');

function registerDiffPlugin(editor: LexicalEditor, props: DiffPluginArgs) {
  const userId = useUserId();

  createEffect(() => {
    const revisionsResponse = props.revisionsSignal();
    if (!revisionsResponse) {
      return;
    }
    props.revisionsSignal.set(undefined);

    let cleanedRevisions: Diff[] = [];
    for (const revision of revisionsResponse) {
      const prev = cleanedRevisions[cleanedRevisions.length - 1];
      if (!prev) {
        cleanedRevisions.push(revision);
        continue;
      }
      const prevOperation = prev.operation;
      const prevNodeKey = prev.node_key;

      if (
        revision.operation === prevOperation &&
        revision.node_key === prevNodeKey
      ) {
        prev.markdown_text += `\n${revision.markdown_text}`;
        continue;
      }
      cleanedRevisions.push(revision);
    }

    for (const revision of cleanedRevisions) {
      const key = revision.node_key;
      const markdownText = revision.markdown_text;
      switch (revision.operation) {
        case 'INSERT_BEFORE':
          editor.dispatchCommand(INSERT_BEFORE_DIFF_COMMAND, {
            key,
            markdownText,
          });
          break;
        case 'INSERT_AFTER':
          editor.dispatchCommand(INSERT_AFTER_DIFF_COMMAND, {
            key,
            markdownText,
          });
          break;
        case 'MODIFY':
          editor.dispatchCommand(MODIFY_DIFF_COMMAND, { key, markdownText });
          break;
        case 'DELETE':
          editor.dispatchCommand(DELETE_DIFF_COMMAND, key);
          break;
        default:
          break;
      }
    }
  });

  return mergeRegister(
    editor.registerCommand(
      INSERT_AFTER_DIFF_COMMAND,
      (args: DiffPayload) => {
        let appliedSuccessfully = false;
        editor.update(() => {
          const node = $getNodeById(
            editor,
            props.nodeIdMap.idToNodeKeyMap,
            args.key
          );
          if (!node) {
            return;
          }

          const parent = node.getParent();
          if (!parent) {
            return;
          }

          for (const ancestor of parent.getParents()) {
            if ($isDiffNode(ancestor)) return false;
          }

          const diffNode = $createDiffNode(userId() ?? '');
          node.insertAfter(diffNode);
          const diffInsertNode = $createDiffInsertNode(args.markdownText);
          diffNode.append(diffInsertNode as any);
          appliedSuccessfully = true;
        });
        return appliedSuccessfully;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      INSERT_BEFORE_DIFF_COMMAND,
      (args: DiffPayload) => {
        let appliedSuccessfully = false;
        editor.update(() => {
          const node = $getNodeById(
            editor,
            props.nodeIdMap.idToNodeKeyMap,
            args.key
          );
          if (!node) {
            return;
          }

          const parent = node.getParent();
          if (!parent) {
            return;
          }

          for (const ancestor of parent.getParents()) {
            if ($isDiffNode(ancestor)) return false;
          }

          const diffNode = $createDiffNode(userId() ?? '');
          node.insertBefore(diffNode);
          const diffInsertNode = $createDiffInsertNode(args.markdownText);
          diffNode.append(diffInsertNode as any);
          appliedSuccessfully = true;
        });
        return appliedSuccessfully;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      MODIFY_DIFF_COMMAND,
      (args: DiffPayload) => {
        let appliedSuccessfully = false;
        editor.update(() => {
          const node = $getNodeById(
            editor,
            props.nodeIdMap.idToNodeKeyMap,
            args.key
          );

          if (!node || $isDiffNode(node)) {
            return;
          }

          const parent = node.getParent();
          if (!parent) {
            return;
          }

          for (const ancestor of parent.getParents()) {
            if ($isDiffNode(ancestor)) return false;
          }

          const diffNode = $createDiffNode(userId() ?? '');
          node.insertBefore(diffNode);
          const diffInsertNode = $createDiffInsertNode(args.markdownText);
          const diffDeleteNode = $wrapNodeInElement(
            node,
            $createDiffDeleteNode
          );
          diffNode.append(diffInsertNode as any, diffDeleteNode as any);
          appliedSuccessfully = true;
        });
        return appliedSuccessfully;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      DELETE_DIFF_COMMAND,
      (key: string) => {
        let appliedSuccessfully = false;
        editor.update(() => {
          const node = $getNodeById(
            editor,
            props.nodeIdMap.idToNodeKeyMap,
            key
          );
          if (!node) {
            return;
          }

          const parent = node.getParent();
          if (!parent) {
            return;
          }

          for (const ancestor of parent.getParents()) {
            if ($isDiffNode(ancestor)) return false;
          }

          const diffNode = $createDiffNode(userId() ?? '');
          node.insertBefore(diffNode);
          const diffInsertNode = $createDiffInsertNode('');
          const diffDeleteNode = $wrapNodeInElement(
            node,
            $createDiffDeleteNode
          );
          diffNode.append(diffInsertNode as any, diffDeleteNode as any);
          appliedSuccessfully = true;
        });
        return appliedSuccessfully;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    mapRegisterDelete(
      editor,
      () => {
        return $diffNodeDeleteAtStart();
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );
}

/** The diff plugin registers the listeners for diff nodes. */
export function diffPlugin(props: DiffPluginArgs) {
  return (editor: LexicalEditor) => {
    return registerDiffPlugin(editor, props);
  };
}

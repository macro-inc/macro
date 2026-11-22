import type { ComposeTaskSuccess } from '@app/features/task-composer/core/types';
import { $createDocumentMentionNode } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import type { ActionContext } from '../../plugins/actions/types';
import {
  INSERT_AWAIT_NODE_COMMAND,
  REPLACE_AWAIT_NODE_COMMAND,
} from '../../plugins/await';
import { INSERT_DOCUMENT_MENTION_COMMAND } from '../../plugins/mentions/mentionsPlugin';
import {
  type CreationKind,
  openCreationComposer,
  trackSlashCreatedMention,
} from './creation';

/** Keep Source callbacks synchronous and construct replacements only for live awaits. */
export function openLexicalCreationComposer(
  editor: LexicalEditor,
  context: ActionContext | undefined,
  kind: CreationKind
): boolean {
  return openCreationComposer(kind, (awaitId) => {
    let placeholderInserted = false;
    return {
      onCreateStart: ({ title }) => {
        const handled = editor.dispatchCommand(INSERT_AWAIT_NODE_COMMAND, {
          awaitId,
          text: `Creating ${title}`,
        });
        placeholderInserted = handled;
      },
      onCreateFailure: () => {
        if (!placeholderInserted) return;
        editor.dispatchCommand(REPLACE_AWAIT_NODE_COMMAND, { awaitId });
        placeholderInserted = false;
      },
      onSuccess: async (result: ComposeTaskSuccess) => {
        const mentionUuid = await trackSlashCreatedMention(
          context,
          result.documentId
        );
        if (placeholderInserted) {
          editor.dispatchCommand(REPLACE_AWAIT_NODE_COMMAND, {
            awaitId,
            $createReplacement: () =>
              $createDocumentMentionNode({
                documentId: result.documentId,
                documentName: result.title,
                blockName: kind === 'task' ? 'task' : 'md',
                createdAt: Date.now(),
                mentionUuid,
              }),
          });
          placeholderInserted = false;
          return;
        }
        editor.dispatchCommand(INSERT_DOCUMENT_MENTION_COMMAND, {
          documentId: result.documentId,
          documentName: result.title,
          blockName: kind === 'task' ? 'task' : 'md',
          mentionUuid,
        });
      },
    };
  });
}

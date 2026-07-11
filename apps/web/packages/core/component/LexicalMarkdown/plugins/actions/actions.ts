import { globalSplitManager } from '@app/signal/splitLayout';
import type { ComposeTaskSuccess } from '@block-md/component/ComposeTask';
import { trackMention } from '@core/signal/mention';
import { LinkNode } from '@lexical/link';
import { ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { INSERT_TABLE_COMMAND, TableNode } from '@lexical/table';
import {
  $createDocumentMentionNode,
  AwaitNode,
  CustomCodeNode,
  DocumentMentionNode,
  EquationNode,
  HorizontalRuleNode,
  ImageNode,
  VideoNode,
} from '@lexical-core';
import CheckSquare from '@phosphor/check-square.svg';
import CodeBlock from '@phosphor/code-block.svg';
import VideoIcon from '@phosphor/file-video.svg';
import MathIcon from '@phosphor/function.svg';
import TableIcon from '@phosphor/grid-four.svg';
import ImageIcon from '@phosphor/image.svg';
import LinkIcon from '@phosphor/link.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListChecks from '@phosphor/list-checks.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import Minus from '@phosphor/minus.svg';
import Quote from '@phosphor/quotes.svg';
import TextH1 from '@phosphor/text-h-one.svg';
import TextH3 from '@phosphor/text-h-three.svg';
import TextH2 from '@phosphor/text-h-two.svg';
import TextT from '@phosphor/text-t.svg';
import type { LexicalEditor } from 'lexical';
import { nanoid } from 'nanoid';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '..';
import {
  INSERT_AWAIT_NODE_COMMAND,
  REPLACE_AWAIT_NODE_COMMAND,
} from '../await';
import { TRY_INSERT_EQUATION_COMMAND } from '../katex';
import { TRY_INSERT_LINK_COMMAND } from '../links';
import { TRY_INSERT_MEDIA_UPLOAD_COMMAND } from '../media';
import { INSERT_DOCUMENT_MENTION_COMMAND } from '../mentions/mentionsPlugin';
import { NODE_TRANSFORM } from '../node-transform';
import { type Action, ActionCategory, type ActionContext } from './types';

async function trackSlashTaskMention(
  context: ActionContext | undefined,
  documentId: string
) {
  if (
    !context?.sourceDocumentId ||
    context.disableMentionTracking ||
    context.sourceBlockName === 'channel' ||
    context.sourceBlockName === 'chat'
  ) {
    return undefined;
  }

  return await trackMention(context.sourceDocumentId, 'document', documentId);
}

export const ACTIONS: Action[] = [
  {
    id: 'paragraph',
    name: 'Normal Text',
    keywords: ['paragraph', 'text', 'none', 'normal'],
    category: ActionCategory.ELEMENT,
    icon: TextT,
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'paragraph');
    },
  },
  {
    id: 'heading1',
    name: 'Heading 1',
    keywords: ['h1', 'title', 'large', 'header'],
    category: ActionCategory.FORMAT,
    icon: TextH1,
    shortcut: '#',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'heading1');
    },
    dependencies: [HeadingNode],
  },
  {
    id: 'heading2',
    name: 'Heading 2',
    keywords: ['h2', 'title', 'medium', 'header'],
    category: ActionCategory.FORMAT,
    icon: TextH2,
    shortcut: '##',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'heading2');
    },
    dependencies: [HeadingNode],
  },
  {
    id: 'heading3',
    name: 'Heading 3',
    keywords: ['h3', 'title', 'medium', 'header'],
    category: ActionCategory.FORMAT,
    icon: TextH3,
    shortcut: '###',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'heading3');
    },
    dependencies: [HeadingNode],
  },
  {
    id: 'quote',
    name: 'Quote',
    keywords: ['quote'],
    category: ActionCategory.ELEMENT,
    icon: Quote,
    shortcut: '>',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'quote');
    },
    dependencies: [QuoteNode],
  },
  {
    id: 'code',
    name: 'Code',
    keywords: ['code', 'pre', 'programming'],
    category: ActionCategory.ELEMENT,
    icon: CodeBlock,
    shortcut: '```',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'code');
    },
    dependencies: [CustomCodeNode],
  },
  {
    id: 'list-bullet',
    name: 'Bullet List',
    keywords: ['bullet', 'list', 'unordered'],
    category: ActionCategory.ELEMENT,
    icon: ListBullets,
    shortcut: '-',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'list-bullet');
    },
    dependencies: [ListNode],
  },
  {
    id: 'list-number',
    name: 'Numbered List',
    keywords: ['numbered', 'list', 'ordered'],
    category: ActionCategory.ELEMENT,
    icon: ListNumbers,
    shortcut: '1.',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'list-number');
    },
    dependencies: [ListNode],
  },
  {
    id: 'list-check',
    name: 'Checklist',
    keywords: ['checklist', 'list', 'checked'],
    category: ActionCategory.ELEMENT,
    icon: ListChecks,
    shortcut: '[]',
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(NODE_TRANSFORM, 'list-check');
    },
    dependencies: [ListNode],
  },
  {
    id: 'task',
    name: 'Task',
    keywords: ['task', 'todo', 'create'],
    category: ActionCategory.ELEMENT,
    icon: CheckSquare,
    action: (editor: LexicalEditor, context?: ActionContext) => {
      const splitManager = globalSplitManager();
      if (!splitManager) return;
      const awaitId = nanoid(21);
      let placeholderInserted = false;
      splitManager.createPopoverSplit({
        content: {
          type: 'component',
          id: 'task-compose',
          params: {
            onCreateStart: ({ title }: { title: string }) => {
              const handled = editor.dispatchCommand(
                INSERT_AWAIT_NODE_COMMAND,
                {
                  awaitId,
                  text: `Creating ${title}`,
                }
              );
              placeholderInserted = handled;
            },
            onCreateFailure: () => {
              if (!placeholderInserted) return;
              editor.dispatchCommand(REPLACE_AWAIT_NODE_COMMAND, { awaitId });
              placeholderInserted = false;
            },
            onSuccess: async (result: ComposeTaskSuccess) => {
              const mentionUuid = await trackSlashTaskMention(
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
                      blockName: 'task',
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
                blockName: 'task',
                mentionUuid,
              });
            },
          },
        },
      });
    },
    dependencies: [DocumentMentionNode, AwaitNode],
  },
  {
    id: 'image',
    name: 'Image',
    keywords: ['picture', 'photo', 'img', 'upload'],
    category: ActionCategory.MEDIA,
    icon: ImageIcon,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        editor.dispatchCommand(TRY_INSERT_MEDIA_UPLOAD_COMMAND, 'all');
      });
    },
    dependencies: [ImageNode, VideoNode],
  },
  {
    id: 'video',
    name: 'Video',
    keywords: ['video', 'movie', 'film', 'upload'],
    category: ActionCategory.MEDIA,
    icon: VideoIcon,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        editor.dispatchCommand(TRY_INSERT_MEDIA_UPLOAD_COMMAND, 'all');
      });
    },
    dependencies: [ImageNode, VideoNode],
  },
  {
    id: 'link',
    name: 'Link',
    keywords: ['link', 'url'],
    icon: LinkIcon,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        editor.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);
      });
    },
    dependencies: [LinkNode],
  },
  {
    id: 'latex',
    name: 'Math',
    keywords: ['math', 'latex', 'equation'],
    icon: MathIcon,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        editor.dispatchCommand(TRY_INSERT_EQUATION_COMMAND, undefined);
      });
    },
    dependencies: [EquationNode],
  },
  {
    id: 'table',
    name: 'Table',
    keywords: ['table', 'grid'],
    icon: TableIcon,
    category: ActionCategory.MEDIA,
    action: (editor: LexicalEditor) => {
      queueMicrotask(() => {
        editor.dispatchCommand(INSERT_TABLE_COMMAND, {
          columns: '5',
          rows: '3',
          includeHeaders: false,
        });
      });
    },
    dependencies: [TableNode],
  },
  {
    id: 'hr',
    name: 'Divider',
    keywords: ['hr', 'horizontal', 'line', 'divider'],
    icon: Minus,
    shortcut: '---',
    category: ActionCategory.ELEMENT,
    action: (editor: LexicalEditor) => {
      editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
    },
    dependencies: [HorizontalRuleNode],
  },
];

import CodeBlock from '@icon/regular/code-block.svg';
import MathIcon from '@icon/regular/function.svg';
import TableIcon from '@icon/regular/grid-four.svg';
import LinkIcon from '@icon/regular/link.svg';
import ListBullets from '@icon/regular/list-bullets.svg';
import ListChecks from '@icon/regular/list-checks.svg';
import ListNumbers from '@icon/regular/list-numbers.svg';
import Minus from '@icon/regular/minus.svg';
import Quote from '@icon/regular/quotes.svg';
import TextH1 from '@icon/regular/text-h-one.svg';
import TextH3 from '@icon/regular/text-h-three.svg';
import TextH2 from '@icon/regular/text-h-two.svg';
import TextT from '@icon/regular/text-t.svg';
import { INSERT_TABLE_COMMAND } from '@lexical/table';
import type { LexicalEditor } from 'lexical';
import type { Component } from 'solid-js';
import { INSERT_HORIZONTAL_RULE_COMMAND } from '..';
import { TRY_INSERT_EQUATION_COMMAND } from '../katex';
import { TRY_INSERT_LINK_COMMAND } from '../links';
import { NODE_TRANSFORM } from '../node-transform';

export type ActionIcon = string;

export type Action = {
  id: string;
  name: string;
  keywords: string[];
  icon: Component<{ class: string }>;
  category: string;
  action: (editor: LexicalEditor) => void;
  shortcut?: string;
};

// TODO (seamus): Actaully oragnize the items based on category.
export enum ActionCategory {
  BASIC = 'Basic',
  FORMAT = 'Formatting',
  ELEMENT = 'Elements',
  MEDIA = 'Media',
  ADVANCED = 'Advanced',
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
  },
  // {
  //   id: 'image',
  //   name: 'Image',
  //   keywords: ['picture', 'photo', 'img'],
  //   category: ActionCategory.MEDIA,
  //   icon: Image,
  //   action: (editor: LexicalEditor) => {
  //     console.log('Insert image');
  //   },
  // },
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
  },
];

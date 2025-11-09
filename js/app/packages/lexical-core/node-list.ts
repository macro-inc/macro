import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { MarkNode } from '@lexical/mark';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  type KlassConstructor,
  type LexicalNode,
  type LexicalNodeReplacement,
  LineBreakNode,
  ParagraphNode,
  TabNode,
  TextNode,
} from 'lexical';
import { ClassedBlockNode } from './nodes/ClassedBlockNode';
import { CommentNode } from './nodes/CommentNode';
import { CompletionNode } from './nodes/CompletionNode';
import { ContactMentionNode } from './nodes/ContactMentionNode';
import { CustomCodeNode } from './nodes/CustomCodeNode';
import { DateMentionNode } from './nodes/DateMentionNode';
import { DiffDeleteNode } from './nodes/DiffDeleteNode';
import { DiffInsertNode } from './nodes/DiffInsertNode';
import { DiffNode } from './nodes/DiffNode';
import { DocumentCardNode } from './nodes/DocumentCardNode';
import { DocumentMentionNode } from './nodes/DocumentMentionNode';
import { EquationNode } from './nodes/EquationNode';
import { HorizontalRuleNode } from './nodes/HorizontalRuleNode';
import { HtmlRenderNode } from './nodes/HtmlRenderNode';
import { ImageNode } from './nodes/ImageNode';
import { InlineSearchNode } from './nodes/InlineSearchNode';
import { SearchMatchNode } from './nodes/SearchMatchNode';
import { UnlinkedTextNode } from './nodes/UnlinkedTextNode';
import { UserMentionNode } from './nodes/UserMentionNode';
import { VideoNode } from './nodes/VideoNode';

/**
 * The pre-specified types of base editor we have configured.
 */
export type EditorType =
  | 'plain-text'
  | 'markdown'
  | 'markdown-sync'
  | 'chat'
  | 'title';

// Valid nodes must be enumerated at Editor construction. We can set up plugins
// lazily, but the node list must be specified fully upfront.
export type ValidNode =
  | KlassConstructor<typeof LexicalNode>
  | LexicalNodeReplacement;

export const SupportedNodeTypes = [
  ParagraphNode,
  TextNode,
  CodeNode,
  CustomCodeNode,
  HeadingNode,
  LinkNode,
  AutoLinkNode,
  ListNode,
  ListItemNode,
  QuoteNode,
  LineBreakNode,
  DocumentMentionNode,
  DocumentCardNode,
  UserMentionNode,
  ContactMentionNode,
  DateMentionNode,
  InlineSearchNode,
  UnlinkedTextNode,
  CodeHighlightNode,
  TabNode,
  ImageNode,
  VideoNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  CompletionNode,
  MarkNode,
  CommentNode,
  SearchMatchNode,
  EquationNode,
  HorizontalRuleNode,
  DiffNode,
  DiffInsertNode,
  DiffDeleteNode,
  HtmlRenderNode,
  ClassedBlockNode,
] as const;

export const NodeReplacements: LexicalNodeReplacement[] = [
  {
    replace: CodeNode,
    with: (node: CodeNode) => new CustomCodeNode(node.getLanguage()),
    withKlass: CustomCodeNode,
  },
];

function exclude(exclusions: ValidNode[]) {
  return SupportedNodeTypes.filter((n) => !exclusions.includes(n));
}

/**
 * You cannot add nodes to the editor after it has been created. This is a
 * mapping of the editor type to the nodes that are available for that editor.
 * If you want an editor with a custom set of nodes, this is the place for that.
 */
export const RegisteredNodesByType: { [K in EditorType]: ValidNode[] } = {
  'plain-text': [ParagraphNode, TextNode],
  markdown: [...SupportedNodeTypes],
  'markdown-sync': [...SupportedNodeTypes],
  chat: exclude([HeadingNode, ImageNode, VideoNode, DocumentCardNode]),
  title: [ParagraphNode, TextNode, InlineSearchNode],
} as const;

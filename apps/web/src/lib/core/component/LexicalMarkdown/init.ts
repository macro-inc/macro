import {
  AgentContextNode,
  AwaitNode,
  ContactMentionNode,
  DateMentionNode,
  DiffInsertNode,
  DocumentCardNode,
  DocumentMentionNode,
  EquationNode,
  GroupMentionNode,
  HorizontalRuleNode,
  HtmlRenderNode,
  ImageNode,
  MagicChipNode,
  PasteNode as PasteNodeClass,
  PullRequestMentionNode,
  SnapshotNode,
  TagMentionNode,
  ThemeMentionNode,
  UnknownMentionNode,
  UserMentionNode,
  VideoNode,
  WatermarkNode,
} from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { AgentContext } from './component/decorator/AgentContext';
import { Await } from './component/decorator/Await';
import { ContactMention } from './component/decorator/ContactMention';
import { DateMention } from './component/decorator/DateMention';
import { DiffInsert } from './component/decorator/DiffInsert';
import { DocumentCard } from './component/decorator/DocumentCard';
import { DocumentMention } from './component/decorator/DocumentMention';
import { Equation } from './component/decorator/Equation';
import { GroupMention } from './component/decorator/GroupMention';
import { HorizontalRule } from './component/decorator/HorizontalRule';
import { HtmlRender } from './component/decorator/HtmlRender';
import { MagicChip } from './component/decorator/MagicChip';
import { MarkdownImage } from './component/decorator/MarkdownImage';
import { MarkdownVideo } from './component/decorator/MarkdownVideo';
import { PasteNode } from './component/decorator/PasteNode';
import { PullRequestMention } from './component/decorator/PullRequestMention';
import { Snapshot } from './component/decorator/Snapshot';
import { TagMention } from './component/decorator/TagMention';
import { ThemeMention } from './component/decorator/ThemeMention';
import { UnknownMention } from './component/decorator/UnknownMention';
import { UserMention } from './component/decorator/UserMention';
import { Watermark } from './component/decorator/Watermark';
import { registerDiffNodeFactory } from './component/dom-factory/diff-factory';

/**
 * This has to run once before any Lexicals mount. Currently imported in index.tsx.
 */
export function initializeLexical() {
  clearDecorators();
  setDecorator(AgentContextNode, AgentContext);
  setDecorator(HorizontalRuleNode, HorizontalRule);
  setDecorator(UserMentionNode, UserMention);
  setDecorator(GroupMentionNode, GroupMention);
  setDecorator(DocumentMentionNode, DocumentMention);
  setDecorator(DocumentCardNode, DocumentCard);
  setDecorator(PasteNodeClass, PasteNode);
  setDecorator(PullRequestMentionNode, PullRequestMention);
  setDecorator(ContactMentionNode, ContactMention);
  setDecorator(DateMentionNode, DateMention);
  setDecorator(DiffInsertNode, DiffInsert);
  setDecorator(ImageNode, MarkdownImage);
  setDecorator(VideoNode, MarkdownVideo);
  setDecorator(EquationNode, Equation);
  setDecorator(SnapshotNode, Snapshot);
  setDecorator(HtmlRenderNode, HtmlRender);
  setDecorator(ThemeMentionNode, ThemeMention);
  setDecorator(TagMentionNode, TagMention);
  setDecorator(UnknownMentionNode, UnknownMention);
  setDecorator(WatermarkNode, Watermark);
  setDecorator(AwaitNode, Await);
  setDecorator(MagicChipNode, MagicChip);
  registerDiffNodeFactory();
}

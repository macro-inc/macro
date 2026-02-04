import {
  ContactMentionNode,
  DateMentionNode,
  DiffInsertNode,
  DocumentCardNode,
  DocumentMentionNode,
  EquationNode,
  SnapshotNode,
  GroupMentionNode,
  HorizontalRuleNode,
  HtmlRenderNode,
  ImageNode,
  ThemeMentionNode,
  UnknownMentionNode,
  UserMentionNode,
  VideoNode,
  WatermarkNode,
} from '@lexical-core';
import { clearDecorators, setDecorator } from '@lexical-core/decoratorRegistry';
import { ContactMention } from './component/decorator/ContactMention';
import { DateMention } from './component/decorator/DateMention';
import { DiffInsert } from './component/decorator/DiffInsert';
import { DocumentCard } from './component/decorator/DocumentCard';
import { DocumentMention } from './component/decorator/DocumentMention';
import { Equation } from './component/decorator/Equation';
import { Snapshot } from './component/decorator/Snapshot';
import { GroupMention } from './component/decorator/GroupMention';
import { HorizontalRule } from './component/decorator/HorizontalRule';
import { HtmlRender } from './component/decorator/HtmlRender';
import { MarkdownImage } from './component/decorator/MarkdownImage';
import { MarkdownVideo } from './component/decorator/MarkdownVideo';
import { UserMention } from './component/decorator/UserMention';
import { ThemeMention } from './component/decorator/ThemeMention';
import { UnknownMention } from './component/decorator/UnknownMention';
import { Watermark } from './component/decorator/Watermark';
import { registerDiffNodeFactory } from './component/dom-factory/diff-factory';

/**
 * This has to run once before any Lexicals mount. Currently imported in index.tsx.
 */
export function initializeLexical() {
  clearDecorators();
  setDecorator(HorizontalRuleNode, HorizontalRule);
  setDecorator(UserMentionNode, UserMention);
  setDecorator(GroupMentionNode, GroupMention);
  setDecorator(DocumentMentionNode, DocumentMention);
  setDecorator(DocumentCardNode, DocumentCard);
  setDecorator(ContactMentionNode, ContactMention);
  setDecorator(DateMentionNode, DateMention);
  setDecorator(DiffInsertNode, DiffInsert);
  setDecorator(ImageNode, MarkdownImage);
  setDecorator(VideoNode, MarkdownVideo);
  setDecorator(EquationNode, Equation);
  setDecorator(SnapshotNode, Snapshot);
  setDecorator(HtmlRenderNode, HtmlRender);
  setDecorator(ThemeMentionNode, ThemeMention);
  setDecorator(UnknownMentionNode, UnknownMention);
  setDecorator(WatermarkNode, Watermark);
  registerDiffNodeFactory();
}

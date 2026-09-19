import { ThreadActionsFooter } from './ThreadActionsFooter';
import { ThreadCollapsedIndicator } from './ThreadCollapsedIndicator';
import { ThreadRepliesBridgeRail } from './ThreadRepliesBridgeRail';
import { ThreadRepliesContainer } from './ThreadRepliesContainer';
import { ThreadReplyAuthor } from './ThreadReplyAuthor';
import { ThreadReplyButton } from './ThreadReplyButton';
import { ThreadReplyInput } from './ThreadReplyInput';
import { ThreadReplyInputConnector } from './ThreadReplyInputConnector';
import { ThreadReplyList } from './ThreadReplyList';
import { ThreadReplyRail } from './ThreadReplyRail';
import { ThreadReplyRailDecorations } from './ThreadReplyRailDecorations';
import { ThreadRootRail } from './ThreadRootRail';
import { ThreadRow } from './ThreadRow';
import { ThreadTerminalRail } from './ThreadTerminalRail';

export const Thread = {
  Row: ThreadRow,
  ReplyRailDecorations: ThreadReplyRailDecorations,
  RepliesContainer: ThreadRepliesContainer,
  ReplyButton: ThreadReplyButton,
  ReplyList: ThreadReplyList,
  ReplyRail: ThreadReplyRail,
  RepliesBridgeRail: ThreadRepliesBridgeRail,
  RootRail: ThreadRootRail,
  TerminalRail: ThreadTerminalRail,
  CollapsedIndicator: ThreadCollapsedIndicator,
  ReplyInputConnector: ThreadReplyInputConnector,
  ReplyAuthor: ThreadReplyAuthor,
  ReplyInput: ThreadReplyInput,
  ActionsFooter: ThreadActionsFooter,
};

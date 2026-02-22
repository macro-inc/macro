import { Root } from './Root';
import { Layout } from './Layout';
import { SenderName } from './SenderName';
import { SenderIcon } from './SenderIcon';
import { Timestamp } from './Timestamp';
import { Content } from './Content';
import { Attachments } from './Attachments';
import { DateDivider } from './DateDivider';
import { NewDivider } from './NewDivider';
import { Reactions } from './Reactions';
import { EditedIndicator } from './EditedIndicator';
import { HoverActions } from './HoverActions';
import { MessageFlag } from './MessageFlag';

export const Message = {
  Root,
  Layout,
  SenderName,
  SenderIcon,
  Timestamp,
  Content,
  Attachments,
  DateDivider,
  NewDivider,
  Reactions,
  EditedIndicator,
  HoverActions,
  MessageFlag,
};

export { ChannelMessage } from './ChannelMessage';
export { Attachments, partitionMessageAttachments } from './Attachments';
export { DateDivider } from './DateDivider';
export { NewDivider } from './NewDivider';
export { MessageFlag } from './MessageFlag';
export type { MessageData } from './types';
export type { ChannelMessageListMeta } from './list-meta';

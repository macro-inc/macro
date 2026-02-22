import { Root } from './Root';
import { Layout } from './Layout';
import { SenderName } from './SenderName';
import { SenderIcon } from './SenderIcon';
import { Timestamp } from './Timestamp';
import { Content } from './Content';
import { Attachments } from './Attachments';
import { Reactions } from './Reactions';
import { EditedIndicator } from './EditedIndicator';
import { HoverActions } from './HoverActions';

export const Message = {
  Root,
  Layout,
  SenderName,
  SenderIcon,
  Timestamp,
  Content,
  Attachments,
  Reactions,
  EditedIndicator,
  HoverActions,
};

export { ChannelMessage } from './ChannelMessage';
export { Attachments, partitionMessageAttachments } from './Attachments';
export type { MessageData } from './types';

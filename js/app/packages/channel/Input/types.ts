import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import type { InputAttachmentTracker as Tracker } from './attachment-tracker';
import type { PersistenceKey } from '@queries/persistence';

export type InputAttachmentKind = 'video' | 'image' | 'document';

export type InputAttachmentData = {
  id: string;
  name: string;
  kind: InputAttachmentKind;
  iconType?: EntityIconSelector;
  pending?: boolean;
  /** Image/video width in pixels (set after upload). */
  width?: number;
  /** Image/video height in pixels (set after upload). */
  height?: number;
};

export type InputPersistenceKey = PersistenceKey;

type InputDataBase = {
  id?: string;
  placeholder?: string;
  value?: string;
  isDraggedOver?: boolean;
  isDraggingOverChannel?: boolean;
  isValidChannelDrag?: boolean;
  showFormatRibbon?: boolean;
  hasPendingAttachments?: boolean;
  attachments?: InputAttachmentData[];
};

export type ChannelInputMode = InputDataBase & { mode: 'channel' };
export type ReplyInputMode = InputDataBase & { mode: 'reply' };
export type InputData = ChannelInputMode | ReplyInputMode;

export const isReplyInput = (input: InputData): input is ReplyInputMode =>
  input.mode === 'reply';

export type InputActionEvent = MouseEvent | KeyboardEvent;

export type InputSnapshot = {
  value: string;
  mentions: ItemMention[];
  attachments: InputAttachmentData[];
};

export type InputCallbacks = {
  onChange?: (snapshot: InputSnapshot) => void | Promise<void>;
  onSend?: (snapshot: InputSnapshot) => void | Promise<void>;
  onToggleFormatRibbon?: (open: boolean) => void | Promise<void>;
  onClose?: (snapshot: InputSnapshot) => void | Promise<void>;
  onRemoveAttachment?: (
    attachment: InputAttachmentData,
    snapshot: InputSnapshot
  ) => void | Promise<void>;
};

export type InputCommands = {
  send: () => Promise<boolean>;
  attachFiles: (files: File[]) => Promise<void>;
  toggleFormatRibbon: () => void;
  close: () => void;
  removeAttachment: (attachment: InputAttachmentData) => void;
};

export type InputHandle = {
  clear: () => void;
  focus: () => void;
  attachFiles: (files: File[]) => Promise<void>;
};

export type InputAttachmentTracker = Tracker;

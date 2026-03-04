import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { InputAttachmentTracker as Tracker } from './attachment-tracker';

export type InputAttachmentKind = 'video' | 'image' | 'document';

export type InputAttachmentData = {
  id: string;
  name: string;
  kind: InputAttachmentKind;
  pending?: boolean;
};

export type InputData = {
  id?: string;
  placeholder?: string;
  value?: string;
  isReplyInput?: boolean;
  isDraggedOver?: boolean;
  isDraggingOverChannel?: boolean;
  isValidChannelDrag?: boolean;
  showFormatRibbon?: boolean;
  showAttachMenu?: boolean;
  hasPendingAttachments?: boolean;
  attachments?: InputAttachmentData[];
};

export type InputActionEvent = MouseEvent | KeyboardEvent;

export type InputSnapshot = {
  value: string;
  mentions: ItemMention[];
  attachments: InputAttachmentData[];
};

export type InputCallbacks = {
  onChange?: (snapshot: InputSnapshot) => void | Promise<void>;
  onSend?: (snapshot: InputSnapshot) => void | Promise<void>;
  onToggleAttachMenu?: (open: boolean) => void | Promise<void>;
  onToggleFormatRibbon?: (open: boolean) => void | Promise<void>;
  onCloseDraft?: (snapshot: InputSnapshot) => void | Promise<void>;
  onRemoveAttachment?: (
    attachment: InputAttachmentData,
    snapshot: InputSnapshot
  ) => void | Promise<void>;
};

export type InputDraftAdapter = {
  save?: (snapshot: InputSnapshot) => void | Promise<void>;
  clear?: () => void | Promise<void>;
};

export type InputCommands = {
  send: () => Promise<boolean>;
  toggleAttachMenu: () => void;
  toggleFormatRibbon: () => void;
  closeDraft: () => void;
  removeAttachment: (attachment: InputAttachmentData) => void;
};

export type InputHandle = {
  clear: () => void;
  focus: () => void;
};

export type InputAttachmentTracker = Tracker;


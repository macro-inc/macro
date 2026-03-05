import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import type { InputAttachmentTracker as Tracker } from './attachment-tracker';

export type InputAttachmentKind = 'video' | 'image' | 'document';

export type InputAttachmentData = {
  id: string;
  name: string;
  kind: InputAttachmentKind;
  iconType?: EntityIconSelector;
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
  attachFiles: (files: File[]) => Promise<void>;
  toggleFormatRibbon: () => void;
  closeDraft: () => void;
  removeAttachment: (attachment: InputAttachmentData) => void;
};

export type InputHandle = {
  clear: () => void;
  focus: () => void;
};

export type InputAttachmentTracker = Tracker;

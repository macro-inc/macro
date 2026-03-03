import type { Accessor } from 'solid-js';

export type InputAttachmentKind = 'video' | 'image' | 'document';

export type InputAttachmentData = {
  id: string;
  name: string;
  kind: InputAttachmentKind;
  pending?: boolean;
};

export type InputTaskData = {
  id: string;
  title: string;
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
  taskModeEnabled?: boolean;
  hasPendingAttachments?: boolean;
  attachments?: InputAttachmentData[];
  tasks?: InputTaskData[];
};

export type InputActionEvent = MouseEvent | KeyboardEvent;

export type InputActionContext = {
  input: InputData;
  event?: InputActionEvent;
  attachment?: InputAttachmentData;
  value?: string;
};

export type InputActionHandler = (
  context: InputActionContext
) => void | Promise<void>;

export type InputActions = {
  onChange?: InputActionHandler;
  onSend?: InputActionHandler;
  onToggleAttachMenu?: InputActionHandler;
  onToggleFormatRibbon?: InputActionHandler;
  onToggleTaskMode?: InputActionHandler;
  onCloseDraft?: InputActionHandler;
  onRemoveAttachment?: InputActionHandler;
};

export type InputAttachmentTracker = {
  attachments: Accessor<InputAttachmentData[]>;
  hasPending: Accessor<boolean>;
  addAttachment: (attachment: InputAttachmentData) => void;
  removeAttachment: (attachmentId: string) => void;
  setAttachmentPending: (attachmentId: string, pending: boolean) => void;
  setAttachments: (attachments: InputAttachmentData[]) => void;
  clearAttachments: () => void;
};

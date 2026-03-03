export { Input } from './Input';
export { ChannelInput } from './ChannelInput';
export { ThreadInput } from './ThreadInput';
export { createInputAttachmentTracker } from './attachment-tracker';
export { createInputState } from './create-input-state';
export { createConfiguredChannelMarkdownEditor } from './createConfiguredChannelMarkdownEditor';

export { Root } from './Root';
export { Layout } from './Layout';
export { DropOverlay } from './DropOverlay';
export { FormatRibbon } from './FormatRibbon';
export { EditorShell } from './EditorShell';
export { Editor } from './Editor';
export { Attachments } from './Attachments';
export { TaskPreview } from './TaskPreview';
export { Footer } from './Footer';
export { PrimaryActions } from './PrimaryActions';
export { AttachMenu } from './AttachMenu';
export { SendAction } from './SendAction';
export { RibbonButton } from './RibbonButton';
export { FormattingRibbon } from './FormattingRibbon';
export { useInput, useInputCommands, InputProvider } from './context';

export type {
  InputData,
  InputAttachmentData,
  InputAttachmentKind,
  InputTaskData,
  InputSnapshot,
  InputCallbacks,
  InputDraftAdapter,
  InputCommands,
  InputHandle,
  // Legacy aliases
  InputActionContext,
  InputActionEvent,
  InputActionHandler,
  InputActions,
  InputAttachmentTracker,
} from './types';

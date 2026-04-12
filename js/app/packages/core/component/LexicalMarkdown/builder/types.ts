import type { EditorType } from '@lexical-core';
import type { PortalScope } from '@core/component/ScopedPortal';
import type { LexicalEditor, SerializedEditorState } from 'lexical';
import type { Store } from 'solid-js/store';
import type { createLexicalWrapper } from '../context/LexicalWrapperContext';
import type {
  createAccessoryStore,
  createDragInsertStore,
  ItemMention,
  PluginManager,
  SelectionData,
} from '../plugins';
import type { createMenuOperations } from '../shared/inlineMenu';
import type { MentionBucketId } from '../component/menu/MentionsMenu/MentionsMenuController';

export interface ActionsOptions {
  useBlockBoundary?: boolean;
}

export interface MentionsOptions {
  sources?: MentionBucketId[];
  onRemove?: (mention: ItemMention) => void;
  onCreate?: (mention: ItemMention) => void;
  block?: string;
  showOpenTabs?: boolean;
  useSnapshotForDocuments?: boolean;
  sourceDocumentId?: string;
  /** Override entity data source (e.g. sandbox data for onboarding). Bypasses quickAccess. */
  entities?: () => import('@core/context/quickAccess').EntityItem[];
  /** Override users data source (e.g. sandbox contacts for onboarding). */
  users?: () => import('@core/user/types').IUser[];
  /** Skip backend mention tracking (e.g. for sandbox/onboarding). */
  disableMentionTracking?: boolean;
}

/** Intentional extension point — no options yet. */
export type EmojisOptions = Record<string, never>;

export interface LinksOptions {
  floatingMenu?: boolean;
}

export interface HistoryOptions {
  timeGap?: number;
}

export interface FilePasteOptions {
  onPasteFilesAndDirs: (
    files: FileSystemFileEntry[],
    directories: FileSystemDirectoryEntry[]
  ) => void;
}

export interface MediaDropOptions {
  constrainedMediaDimensions?: { width: number; height: number };
}

export interface MediaOptions {
  fileDrop?: boolean | MediaDropOptions;
}

export interface FocusLeaveCallbacks {
  /** Called when keyboard focus leaves the start of the editor (e.g. Shift+Tab, ArrowUp) */
  onStart: (e: KeyboardEvent) => void;
  /** Called when keyboard focus leaves the end of the editor (e.g. Tab, ArrowDown) */
  onEnd: (e: KeyboardEvent) => void;
}

/**
 * Basic interaction callbacks that can be registered with .onEnter(myCallback)
 * on the builder.
 */
export interface EditorCallbacks {
  onEnter?: (event: KeyboardEvent, markdown: string) => boolean;
  onEscape?: (event: KeyboardEvent) => boolean;
  onTab?: (event: KeyboardEvent) => boolean;
  onChange?: (markdown: string) => void;
}

/**
 * The controls likely to be needed to by the markdown editor host component.
 */
export interface EditorControls {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  getState: () => SerializedEditorState;
  setState: (state: SerializedEditorState) => void;
  getLexical: () => LexicalEditor;
  isMentionMenuOpen: () => boolean;
}

/**
 * Props of an Editor component.
 */
export interface EditorComponentProps {
  placeholder?: string;
  /** Initialize with markdown text */
  initialValue?: string;
  /** Initialize with a serialized editor state. Takes precedence over initialValue. */
  initialState?: SerializedEditorState;
  disabled?: boolean;
  autofocus?: boolean;
  class?: string;
  portalScope?: PortalScope;
}

export interface EditorConfig {
  type: EditorType;
  namespace: string;
  mentions?: MentionsOptions;
  emojis?: EmojisOptions;
  links?: LinksOptions;
  history?: HistoryOptions;
  singleLine: boolean;
  handlers: EditorCallbacks;
  media: MediaOptions | false;
  code: boolean;
  checkboxToTask: boolean;
  filePaste?: FilePasteOptions;
  restoreFocus: boolean;
  focusLeave?: FocusLeaveCallbacks;
  withIds: boolean;
  selectionData: boolean;
  actions: ActionsOptions | false;
  /** When true, decorator components skip backend fetches (e.g. preview API). */
  skipPreviewFetch: boolean;
}

/** @internal consumed by MarkdownShell; do not access directly */
export interface EditorInternals {
  builderConfig: EditorConfig;
  lexicalWrapper: ReturnType<typeof createLexicalWrapper>;
  editor: LexicalEditor;
  cleanupLexical: () => void;
  isInteractable: () => boolean;
  setIsInteractable: (v: boolean) => void;
  markdownState: () => string;
  actionsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  mentionsMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  emojisMenuOps: ReturnType<typeof createMenuOperations> | undefined;
  accessoryStore: ReturnType<typeof createAccessoryStore>[0] | undefined;
  dragInsertStore: ReturnType<typeof createDragInsertStore>[0] | undefined;
  fileDropConfig: MediaDropOptions | undefined;
}

export interface EditorHandle {
  controls: EditorControls;
  lexical: LexicalEditor;
  plugins: PluginManager;
  selection?: Store<SelectionData>;
  /** @internal consumed by MarkdownShell component; do not access directly */
  _internal: EditorInternals;
}

/**
 * Minimal interface satisfied by {@link MarkdownConfigBuilder}.
 * `MarkdownShell` accepts this instead of the concrete class to avoid a
 * circular module dependency.
 */
export interface EditorBuilder {
  /** Called once by `<MarkdownShell>` to instantiate reactive state. Can also be called directly for low-level Lexical access. */
  buildHandle(): EditorHandle;
}

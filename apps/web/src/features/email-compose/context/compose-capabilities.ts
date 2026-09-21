import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import type { EmailDraft } from '../core/email-draft';
import type { EmailRecipient } from '../core/email-recipient';

export interface EmailInbox {
  id: string;
  email_address: string;
  displayName?: string;
  photo_url?: string | null;
  settings: {
    signature?: string | null;
    signature_on_replies_forwards?: boolean | null;
  };
}

/** Identity returned by a successful save or send. Transport envelopes stay in adapters. */
export interface PersistedEmailIdentity {
  draftId?: string;
  threadId?: string;
  inboxId: string;
}

/**
 * A draft save's identity plus how it landed. `queued`: the durable
 * mutation queue accepted the write under the caller's client handles, which
 * the server may not know yet; REST-only actions cannot use them until a
 * later save commits. Absent means committed.
 */
export interface DraftSaveResult extends PersistedEmailIdentity {
  persistence?: 'committed' | 'queued';
}

/** Server rejection codes for a draft save or delete. None is retried by autosave. */
export type DraftPersistFailureCode =
  | 'DRAFT_ALREADY_SENT'
  | 'NOT_FOUND'
  | 'INBOX_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID'
  | 'INTERNAL';

/**
 * A deterministic server rejection of a draft save or delete. Transport
 * failures reject with a plain error and may be retried; this one carries
 * the code so a composer can interpret it (an already-sent draft resets the
 * composer, anything else latches autosave).
 */
export class DraftPersistRejected extends Error {
  constructor(readonly code: DraftPersistFailureCode) {
    super(`Draft persistence rejected: ${code}`);
    this.name = 'DraftPersistRejected';
  }
}

/**
 * Client-minted identity for a draft the server has not confirmed. Carried
 * apart from `draft.db_id` (a server id) because only the durable queue can
 * resolve handles; a REST save ignores them and mints server ids instead.
 */
export interface DraftClientHandles {
  draftId: string;
  threadId?: string;
}

export interface SaveEmailDraft {
  draft: EmailDraft;
  clientHandles?: DraftClientHandles;
  previousThreadId?: string;
  inboxId?: string;
  completingThread?: boolean;
}
export interface DeleteEmailDraft {
  draftId: string;
  threadId?: string;
  inboxId?: string;
  completingThread?: boolean;
}
export interface SendEmailDraft {
  message: EmailDraft;
  inboxId?: string;
  completingThread?: boolean;
}
export interface UploadEmailAttachments {
  draftId: string;
  attachments: File[];
  inboxId?: string;
  onAttachmentAdded?: (file: File, id: string) => void;
  onAttachmentUploadFailed?: (file: File) => void;
}
export interface EmailAttachmentChange {
  draftId: string;
  attachmentId: string;
  inboxId?: string;
}

export interface EmailDraftStorage {
  saveDraft(input: SaveEmailDraft): Promise<DraftSaveResult>;
  deleteDraft(input: DeleteEmailDraft): Promise<void>;
  restoreDraft(input: {
    draftId: string;
    threadId?: string;
    draft?: Omit<EmailDraft, 'body_html'>;
    html?: string;
    inboxId?: string;
  }): Promise<void>;
}

export interface EmailAttachmentStorage {
  uploadAttachments(input: UploadEmailAttachments): Promise<void>;
  addForwardedAttachments(input: {
    draftId: string;
    attachments: { attachmentId: string }[];
    inboxId?: string;
  }): Promise<void>;
  removeAttachment(input: EmailAttachmentChange): Promise<void>;
  removeForwardedAttachment(input: EmailAttachmentChange): Promise<void>;
}

export interface EmailDelivery {
  sendMessage(input: SendEmailDraft): Promise<PersistedEmailIdentity>;
  unschedule(input: { draftId: string; inboxId?: string }): Promise<void>;
  schedule(
    input: {
      draftId: string;
      sendTime: string;
      includeSignature?: boolean;
    },
    inboxId?: string
  ): Promise<void>;
  archive(
    input: { threadId: string; value: boolean },
    inboxId?: string
  ): Promise<void>;
  undoSend(input: {
    threadId?: string;
    draftId: string;
    inboxId: string | undefined;
    onUndone: () => Promise<void> | void;
  }): Promise<void>;
}

export type EmailDraftLifecycleState =
  | {
      type: 'editing';
      draftId: string;
      threadId: string;
      inboxId: string;
      observedAt: number;
    }
  | {
      type: 'scheduled';
      draftId: string;
      threadId: string;
      inboxId: string;
      sendTime: string;
      observedAt: number;
    }
  | {
      type: 'sent';
      draftId: string;
      threadId: string;
      inboxId: string;
      observedAt: number;
    }
  | {
      type: 'missing';
      draftId: string;
      threadId: string;
      inboxId?: string;
      observedAt: number;
    };

export interface EmailDraftLifecycleSource {
  observe(input: {
    draftId: Accessor<string | null | undefined>;
    threadId: Accessor<string | null | undefined>;
    inboxId: Accessor<string | undefined>;
  }): {
    state: Accessor<EmailDraftLifecycleState | undefined>;
    /** Prior observations stay invalid after failure until a fresh read succeeds. */
    refresh(): Promise<EmailDraftLifecycleState | undefined>;
  };
}

export interface EmailComposeFeedback {
  feedback: {
    success(
      message: string,
      options?: ComposeNoticeOptions
    ): number | undefined;
    failure(message: string, options?: ComposeNoticeOptions): void;
    alert(message: string, options?: ComposeNoticeOptions): void;
    dismiss(id: number): void;
  };
  /** A modal notice with a single acknowledgement; resolves when dismissed. */
  blockingNotice(input: { title: string; body: string }): Promise<void>;
  reportError(error: unknown): void;
}

/** Best-effort device connectivity; a false negative surfaces as the guarded action's own failure. */
export interface EmailConnectivity {
  looksOffline(): boolean;
}

export interface EmailComposeAccounts {
  inboxes: Accessor<EmailInbox[]>;
  loading: Accessor<boolean>;
  failed: Accessor<boolean>;
  primaryId: Accessor<string | undefined>;
}

/** View wiring; controllers do not receive these presentation capabilities. */
export interface EmailComposePresentation {
  viewerLoading: Accessor<boolean>;
  onUpgrade(): void;
  prepareSignatureLinks(root: ShadowRoot): void;
  isTouch: Accessor<boolean>;
  isMobile: Accessor<boolean>;
  scheduleEnabled: boolean;
  signaturesEnabled: Accessor<boolean>;
}

export interface EmailEditorFiles {
  readDroppedFiles: import('./editor-capabilities').ComposeBodyActions['readDroppedFiles'];
  makePublic(id: string): void;
  uploadEditorFiles(input: {
    editor: LexicalEditor | undefined;
    sourceId?: string;
    files: FileSystemFileEntry[];
    directories: FileSystemDirectoryEntry[];
    dropEvent?: DragEvent;
    onUploaded(ids: string[]): void;
  }): void;
}

/** Production composition groups capabilities for views to wire into their consumers. */
export interface EmailComposeContext {
  drafts: EmailDraftStorage;
  attachmentStorage: EmailAttachmentStorage;
  delivery: EmailDelivery;
  draftLifecycle: EmailDraftLifecycleSource;
  notices: EmailComposeFeedback;
  accounts: EmailComposeAccounts;
  connectivity: EmailConnectivity;
  presentation: EmailComposePresentation;
  editorFiles: EmailEditorFiles;
  viewerEmail: Accessor<string | undefined>;
  recipients: Accessor<EmailRecipient[]>;
  recipientName(id: string): string;
  hasPaidAccess: Accessor<boolean>;
  recordMention(sourceId: string, targetId: string): void;
}

export interface ComposeNoticeOptions {
  subtext?: string;
  duration?: number;
  actions?: { label: string; onClick: () => void }[];
}
export interface EmailComposeHost {
  focusSibling?: (direction: 'next' | 'prev') => boolean | void;
  showThread?: (id: string) => void;
  showDraft?: (id: string) => void;
  goBack?: () => void;
  registerBack?: (handler: () => boolean) => void;
}
export interface EmailUndoHandle {
  id: string;
  undo(callbacks?: {
    onSuccess?: () => void;
    onError?: (error: Error) => void;
    onSettled?: () => void;
  }): Promise<void>;
  dispose(): void;
}

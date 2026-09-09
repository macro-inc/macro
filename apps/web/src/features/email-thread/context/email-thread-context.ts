import type { Accessor } from 'solid-js';
import type { EmailRecipient } from '../../email-compose/core/email-recipient';
import type { EmailThread } from '../core/email-thread';
import type { EmailThreadKeyboardHandlers } from '../core/thread-keyboard';

/** A reversible thread action, independent of the app's undo stack. */
export interface ThreadUndoHandle {
  id: string;
  undo(callbacks?: {
    onSuccess?: () => void;
    onError?: (error: Error) => void;
    onSettled?: () => void;
  }): Promise<void>;
  dispose(): void;
}

export interface ArchiveThreadOptions {
  silent?: boolean;
  onUndoHandle?: (handle: ThreadUndoHandle) => void;
  nextEntityId?: string;
}

/** Domain snapshots and request progress; query keys and cursors stay in the adapter. */
export interface EmailThreadSource {
  id: Accessor<string>;
  isError: Accessor<boolean>;
  thread: Accessor<EmailThread | undefined>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isFetchingOlder: Accessor<boolean>;
  hasMore: Accessor<boolean>;
  fetchOlder(): Promise<void>;
  refresh(): Promise<void>;
}

export interface EmailThreadCommands {
  archiveThread(options?: ArchiveThreadOptions): boolean;
  isThreadDone: Accessor<boolean>;
  canMarkThreadNotDone: Accessor<boolean>;
  markThreadNotDone(): boolean;
  isThreadMarkedUnread: Accessor<boolean>;
  markThreadUnread(): boolean;
  markThreadRead(): boolean;
  getMarkDoneNavigationTargetId(): string | undefined;
  blockSender(): boolean;
  markSenderSignal(): boolean;
  markSenderNoise(): boolean;
}

export interface EmailThreadContext {
  source: EmailThreadSource;
  recipients: Accessor<EmailRecipient[]>;
  viewerEmail: Accessor<string | undefined>;
  viewerLoading: Accessor<boolean>;
  isTouch: Accessor<boolean>;
  isMobile: Accessor<boolean>;
  createCommands(
    thread: Accessor<EmailThread | undefined>
  ): EmailThreadCommands;
}

/** Host behavior is optional. A thread can render without a block or router. */
export interface EmailThreadHost {
  isActive?: Accessor<boolean>;
  registerKeyboard?: (handlers: EmailThreadKeyboardHandlers) => void;
  targetMessageId?: Accessor<string | undefined>;
  focusContainer?: () => void;
}

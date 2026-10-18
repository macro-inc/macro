import type { Accessor } from 'solid-js';
import type {
  ReplyAttachment,
  ReplyAttempt,
  ReplyRequest,
  ReplyTemplate,
} from '../core/conversation';

/** The composer owns interaction; adapters own network and query/cache behavior. */
export type ReplySource = {
  send: (request: ReplyRequest) => Promise<ReplyAttempt>;
  isSending: Accessor<boolean>;
  isQueued: (intent: string) => boolean;
  upload: (file: File) => Promise<ReplyAttachment>;
  isUploading: Accessor<boolean>;
  templates: (enabled: Accessor<boolean>) => {
    items: Accessor<ReplyTemplate[]>;
    ready: Accessor<boolean>;
    failed: Accessor<boolean>;
    refresh: () => Promise<unknown>;
  };
};

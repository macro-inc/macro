import type { ImagePolicy, PreparedEmailBody } from '@macro-inc/email-renderer';
import type {
  ResourceLifetime,
  ThemeColorParams,
} from '@macro-inc/email-renderer/browser';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { EmailAttachment } from '../core/email-message';

/** A body the server prepared for the reader's default view. */
export interface ServerPreparedBody {
  body: PreparedEmailBody;
  /** The proxy the server applied to `img[src]`. */
  imageProxyUrl: string | null;
  /** UTF-16 length of the HTML and replyless HTML it was prepared from. */
  sourceLength: number;
}

/** Rendering capabilities shared by email surfaces; no thread or block state. */
export interface EmailRenderingContextValue {
  theme: Accessor<ThemeColorParams>;
  /** Server-prepared bodies for this surface's messages, by message id. */
  preparedBody?: (messageId: string) => ServerPreparedBody | undefined;
  images?: ImagePolicy;
  prepareLinks?: (container: HTMLElement) => void;
  resolveImages(
    root: ShadowRoot,
    attachments: EmailAttachment[],
    lifetime: ResourceLifetime
  ): Promise<void>;
}

const EmailRenderingContext = createContext<EmailRenderingContextValue>();
export const EmailRenderingProvider = EmailRenderingContext.Provider;

export function useEmailRenderingContext(): EmailRenderingContextValue {
  const value = useContext(EmailRenderingContext);
  if (!value)
    throw new Error('Email rendering requires an EmailRenderingProvider');
  return value;
}

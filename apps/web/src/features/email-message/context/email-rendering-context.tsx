import type { ImagePolicy } from '@macro-inc/email-renderer';
import type {
  ResourceLifetime,
  ThemeColorParams,
} from '@macro-inc/email-renderer/browser';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { EmailAttachment } from '../core/email-message';
import type { EmailPreparation, PreparedOrigin } from './email-preparation';

/** A body's first display in a view, timed from the body's creation. */
export interface EmailBodyShown {
  messageId: string;
  /** `cache`: the prepared-body cache path; `direct`: parsed on mount. */
  path: 'cache' | 'direct';
  /** `memory` for a prepared body ready at mount; `direct` when parsed in place. */
  source: 'memory' | PreparedOrigin | 'direct';
  prepareMs: number;
  mountMs: number;
  totalMs: number;
  htmlLength: number;
}

/** Rendering capabilities shared by email surfaces; no thread or block state. */
export interface EmailRenderingContextValue {
  /** Bodies opened while this is true take the prepared-body cache path. */
  cachedBodies?: Accessor<boolean>;
  /** Observes each body's first display. */
  reportBodyShown?: (shown: EmailBodyShown) => void;
  /**
   * Registers a body that is about to show HTML, so a thread open can wait for
   * it; the returned function releases a body that unmounts first.
   */
  trackBodyOpen?: (messageId: string) => () => void;
  /** Revokes mounted content/resources when the owning session ends. */
  canRender?: Accessor<boolean>;
  preparation?: EmailPreparation;
  theme: Accessor<ThemeColorParams>;
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

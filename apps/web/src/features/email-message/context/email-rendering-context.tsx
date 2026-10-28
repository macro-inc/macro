import type { ImagePolicy } from '@macro-inc/email-renderer';
import type {
  ResourceLifetime,
  ThemeColorParams,
} from '@macro-inc/email-renderer/browser';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { EmailAttachment } from '../core/email-message';

/** Rendering capabilities shared by email surfaces; no thread or block state. */
export interface EmailRenderingContextValue {
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

import { type Accessor, createContext, useContext } from 'solid-js';
import type { EmailAttachment } from '../core/email-message';

export interface EmailRenderingTheme {
  inkL: number;
  inkC: number;
  inkH: number;
  panelL: number;
  accentL: number;
  accentC: number;
  accentH: number;
}

/** Rendering capabilities shared by email surfaces; no thread or block state. */
export interface EmailRenderingDependencies {
  theme: Accessor<EmailRenderingTheme>;
  prepareLinks?: (container: HTMLElement) => void;
  resolveImages(
    root: ShadowRoot,
    attachments: EmailAttachment[],
    blobUrls: string[],
    isDisposed: () => boolean
  ): Promise<void>;
}

const EmailRenderingContext = createContext<EmailRenderingDependencies>();
export const EmailRenderingProvider = EmailRenderingContext.Provider;

export function useEmailRendering(): EmailRenderingDependencies {
  const value = useContext(EmailRenderingContext);
  if (!value)
    throw new Error('Email rendering requires an EmailRenderingProvider');
  return value;
}

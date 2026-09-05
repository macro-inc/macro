import { createContext, useContext } from 'solid-js';
import type { ComposeContextValue } from '../primitives/compose-view-state';

export type {
  ComposeContextValue,
  ComposeValidationError,
  EmailFormRecipients,
  RecipientFieldId,
} from '../primitives/compose-view-state';

const ComposeContext = createContext<ComposeContextValue>();

export const ComposeProvider = ComposeContext.Provider;

export function useCompose(): ComposeContextValue {
  const ctx = useContext(ComposeContext);
  if (!ctx) {
    throw new Error('useCompose must be used within a ComposeProvider');
  }
  return ctx;
}

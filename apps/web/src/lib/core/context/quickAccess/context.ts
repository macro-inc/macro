import { createContext, useContext } from 'solid-js';
import type { QuickAccessContextValue } from './types';

const QuickAccessContext = createContext<QuickAccessContextValue>();

export const QuickAccessContextProvider = QuickAccessContext.Provider;

export function useQuickAccess(): QuickAccessContextValue {
  const value = useContext(QuickAccessContext);
  if (!value) {
    throw new Error(
      'QuickAccessContext must be used within <QuickAccessContextProvider />'
    );
  }
  return value;
}

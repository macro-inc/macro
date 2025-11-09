import type { View } from '@core/types/view';
import {
  type Accessor,
  createContext,
  type Setter,
  useContext,
} from 'solid-js';

export const SoupContext = createContext<{
  splitHotkeyScope: string;
  setSelectedView: Setter<View>;
  tabButtonsRef: Accessor<HTMLDivElement | null>;
}>();

export function useSoupContext() {
  const context = useContext(SoupContext);
  if (!context)
    throw new Error('useSoupContext must be used within a SoupContext');

  return context;
}

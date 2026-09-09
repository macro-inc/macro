import { createContext, useContext } from 'solid-js';
import type { SplitContent } from './split-layout/layoutManager';
export type RightPanelContent = Exclude<SplitContent, { type: 'component' }>;
export const RightPanelContext = createContext<{
  open: (content: RightPanelContent) => void;
}>();
export const useRightPanel = () => useContext(RightPanelContext);

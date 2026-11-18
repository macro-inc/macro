import { type Accessor, createContext, useContext } from 'solid-js';
export const MobileComposerContext = createContext<{
  collapsed: Accessor<boolean>;
}>();
export function useMobileComposer() {
  const state = useContext(MobileComposerContext);
  if (!state) throw new Error('MobileComposerRoot is required');
  return state;
}

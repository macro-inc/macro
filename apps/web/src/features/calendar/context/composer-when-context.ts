import { createContext, useContext } from 'solid-js';
import type { ComposerWhenModel } from '../primitives/create-composer-when';
export const ComposerWhenContext = createContext<ComposerWhenModel>();
export function useComposerWhen() {
  const model = useContext(ComposerWhenContext);
  if (!model) throw new Error('When parts require ComposerWhenRoot');
  return model;
}
export function useComposerWhenOptional() {
  return useContext(ComposerWhenContext);
}

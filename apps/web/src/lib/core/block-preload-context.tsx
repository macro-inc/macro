import { createContext, useContext } from 'solid-js';
import type { BlockPreloader } from './block-preload';

export const BlockPreloadContext = createContext<BlockPreloader>();

/** The account scope owns warming and is required for app navigation. */
export function useBlockPreloader() {
  const preloader = useContext(BlockPreloadContext);
  if (!preloader)
    throw new Error('Block preloading requires its account provider');
  return preloader;
}

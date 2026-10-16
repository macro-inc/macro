import type { BlockName } from '@core/block';
import { createContext, useContext } from 'solid-js';

/**
 * The surface rendered markdown sits in, for views outside the legacy block
 * system (the channels shell): cards nest under it as they would under the
 * block of that name.
 */
export const MarkdownHostContext = createContext<BlockName>();

export function useMarkdownHost(): BlockName | undefined {
  return useContext(MarkdownHostContext);
}

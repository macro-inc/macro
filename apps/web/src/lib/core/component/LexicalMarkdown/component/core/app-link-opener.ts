import { createContext, useContext } from 'solid-js';

/**
 * Opens a link inside the app instead of a browser tab. Returns false for a
 * link it leaves to `openExternalUrl`.
 */
export type AppLinkOpener = (url: string) => boolean;

/** Set by a surface whose links open in the app, such as an agent's reply. */
export const AppLinkOpenerContext = createContext<AppLinkOpener>();

export function useAppLinkOpener(): AppLinkOpener | undefined {
  return useContext(AppLinkOpenerContext);
}

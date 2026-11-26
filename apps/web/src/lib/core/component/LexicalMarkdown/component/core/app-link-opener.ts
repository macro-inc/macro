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

/** What a link's hover card says in place of its URL. */
export type AppLinkPreview = { title: string; subtitle: string };

/**
 * Names a link the surface knows better than its URL, such as a reference to
 * code; undefined leaves the usual hover card.
 */
export type AppLinkDescriber = (url: string) => AppLinkPreview | undefined;

export const AppLinkDescriberContext = createContext<AppLinkDescriber>();

export function useAppLinkDescriber(): AppLinkDescriber | undefined {
  return useContext(AppLinkDescriberContext);
}

import { createContext } from 'solid-js';

/**
 * An agent session may handle connection in place and resume its own pending
 * request. `connect` resolves `true` once the app is connected.
 */
export const AppConnectionContext = createContext<{
  connect: (app: { appSlug: string; name: string }) => Promise<boolean>;
  disabled: () => boolean;
}>();

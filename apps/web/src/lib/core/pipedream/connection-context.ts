import { createContext } from 'solid-js';

/** A chat may handle connection in place and resume its own pending request. */
export const AppConnectionContext = createContext<{
  connect: (app: { appSlug: string; name: string }) => Promise<void>;
  disabled: () => boolean;
}>();

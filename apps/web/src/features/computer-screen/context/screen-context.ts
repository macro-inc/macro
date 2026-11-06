import { type Accessor, createContext, useContext } from 'solid-js';

export type ScreenHost = {
  sessionId: Accessor<string | undefined>;
  harnessId: Accessor<string | undefined>;
  canEdit: Accessor<boolean>;
  touch: Accessor<boolean>;
  resolveUrl: (harnessId: string, control: boolean) => Promise<string>;
};
export type ScreenController = {
  host: ScreenHost;
  available: Accessor<boolean>;
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
};
const ScreenContext = createContext<ScreenController>();
export const ScreenProvider = ScreenContext.Provider;
export const useOptionalScreen = () => useContext(ScreenContext);
export function useScreen() {
  const screen = useOptionalScreen();
  if (!screen) throw new Error('Screen requires a ScreenProvider');
  return screen;
}

export type ScreenConnection = { disconnect: () => void };
export type ConnectScreen = (
  target: HTMLElement,
  url: string,
  control: boolean,
  events: {
    connected: () => void;
    disconnected: () => void;
  }
) => Promise<ScreenConnection>;

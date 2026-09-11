import type { SettingsTab } from '@core/constant/SettingsState';
import {
  createContext,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

export function createMobileSettingsState() {
  const [open, setOpen] = createSignal(false);
  const [page, setPage] = createSignal<SettingsTab>();

  return {
    open,
    page,
    openSettings: (tab?: SettingsTab) => {
      setPage(tab);
      setOpen(true);
    },
    selectPage: (tab?: SettingsTab) => setPage(tab),
    close: () => setOpen(false),
  };
}

const MobileSettingsContext =
  createContext<ReturnType<typeof createMobileSettingsState>>();

export function MobileSettingsProvider(props: ParentProps) {
  return (
    <MobileSettingsContext.Provider value={createMobileSettingsState()}>
      {props.children}
    </MobileSettingsContext.Provider>
  );
}

export const useMobileSettings = () => useContext(MobileSettingsContext);

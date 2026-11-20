import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { type Accessor, createSignal } from 'solid-js';
import { type NewHomeTab, parseNewHomeTab } from './core/new-home-mode';

const tabStorage = createUserScopedStorage('macro:new-home:tab:v1');
const condensedStorage = createUserScopedStorage(
  'macro:notifications:condensed:v1'
);

/** The tab New Home opens on: the one the viewer last had open. */
export function readNewHomeTab(userId: string): NewHomeTab {
  return parseNewHomeTab(tabStorage.read(userId));
}

export function saveNewHomeTab(userId: string, tab: NewHomeTab) {
  tabStorage.write(userId, tab);
}

/** Whether the viewer reads notifications as one-line rows, kept per user. */
export function createCondensedPreference(): {
  condensed: Accessor<boolean>;
  setCondensed: (condensed: boolean) => void;
} {
  const userId = useUserId();
  const savedFor = (id: string | undefined) =>
    id ? condensedStorage.read(id) === 'true' : false;
  const [condensed, setCondensed] = createSignal(savedFor(userId()));
  return {
    condensed,
    setCondensed: (next) => {
      setCondensed(next);
      const id = userId();
      if (id) condensedStorage.write(id, String(next));
    },
  };
}

import { type Accessor, createSignal } from 'solid-js';

/**
 * Whether the reader sees notifications as one-line Condensed rows, kept in
 * `storage` between visits.
 */
export function createCondensedPreference(storage: {
  read: () => string | null;
  write: (value: string) => void;
}): {
  condensed: Accessor<boolean>;
  setCondensed: (condensed: boolean) => void;
} {
  const [condensed, setCondensed] = createSignal(storage.read() === 'true');
  return {
    condensed,
    setCondensed: (next) => {
      setCondensed(next);
      storage.write(String(next));
    },
  };
}

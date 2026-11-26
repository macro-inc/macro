import { type Accessor, createEffect, createSignal, on } from 'solid-js';

/**
 * Whether Email's phone search page is open. Closing it ends its search, so
 * no query stays applied to the list without a field to clear it.
 */
export function createEmailMobileSearch(options: {
  /** The flag is on and the current tab can be searched. */
  available: Accessor<boolean>;
  search: Accessor<string>;
  setSearch: (search: string) => void;
}) {
  // A view restored with a search opens on its results.
  const [open, setOpen] = createSignal(options.search().trim() !== '');
  const searching = () => options.available() && open();

  const close = () => {
    options.setSearch('');
    setOpen(false);
  };

  // The page can also go away without Cancel (the flag turns off, the tab
  // changes to one that cannot search); its search ends with it.
  createEffect(
    on(
      searching,
      (now, before) => {
        if (before && !now) close();
      },
      { defer: true }
    )
  );

  return { searching, open: () => setOpen(true), close };
}

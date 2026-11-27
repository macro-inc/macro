import { type Accessor, createSignal } from 'solid-js';

export type DriveInspectorTab = 'preview' | 'details';

export type DriveInspectorState = {
  isOpen: Accessor<boolean>;
  tab: Accessor<DriveInspectorTab>;
  open: (tab?: DriveInspectorTab) => void;
  close: () => void;
  toggle: () => void;
  setTab: (tab: DriveInspectorTab) => void;
};

/**
 * Controls the Finder-style Quick Look / Details inspector pane. The inspected
 * item itself derives from the active list selection/focus so arrowing up and
 * down scrubs the live preview automatically.
 */
export function createDriveInspector(options: {
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
}): DriveInspectorState {
  const [tab, setTab] = createSignal<DriveInspectorTab>('preview');

  return {
    isOpen: options.open,
    tab,
    open: (nextTab) => {
      if (nextTab) setTab(nextTab);
      options.setOpen(true);
    },
    close: () => options.setOpen(false),
    toggle: () => options.setOpen(!options.open()),
    setTab,
  };
}

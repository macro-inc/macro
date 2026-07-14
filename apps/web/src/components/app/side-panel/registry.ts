/**
 * Module-level registry of mounted SidePanel layouts so global chrome
 * shortcuts (e.g. cmd+. "toggle sidebar") can show/hide every right-hand
 * side panel, not just the panel owned by the focused split.
 */

type SidePanelInstance = {
  setIsOpen: (open: boolean) => void;
  isNarrow: () => boolean;
};

const instances = new Set<SidePanelInstance>();

/** Register a mounted side panel. Returns a disposer. */
export function registerSidePanelInstance(instance: SidePanelInstance) {
  instances.add(instance);
  return () => {
    instances.delete(instance);
  };
}

/**
 * Show/hide every mounted side panel. Narrow layouts render the panel as a
 * full-screen overlay, so they are only ever hidden — never force-opened.
 */
export function setAllSidePanelsOpen(open: boolean) {
  for (const instance of instances) {
    if (open && instance.isNarrow()) continue;
    instance.setIsOpen(open);
  }
}

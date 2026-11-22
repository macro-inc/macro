// The sidebar's list reads the shell only to close a phone overlay.
export function useViewShell() {
  return { aside: { isOverlay: () => false, collapse: () => {} } };
}
export const CollapsibleSection = {};
export const ViewSidebar = {};

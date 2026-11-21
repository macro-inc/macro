import { type ComponentProps, type JSX, Show } from 'solid-js';

// The sidebar's list reads the shell only to close a phone overlay.
export function useViewShell() {
  return { aside: { isOverlay: () => false, collapse: () => {} } };
}
export const CollapsibleSection = {};
// The calendar list's rows: a plain disclosure button and its branch.
export const ViewSidebar = {
  Control: (props: ComponentProps<'button'>) => (
    <button type="button" {...props} />
  ),
  Branch: (props: { open: boolean; children: JSX.Element }) => (
    <Show when={props.open}>{props.children}</Show>
  ),
};

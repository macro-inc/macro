import { type Component, createContext, useContext } from 'solid-js';
import type { ColumnTypeMenuProps } from '../components/column-type-menu';
import type { DatabaseViewColumn } from '../core/database-view';

/** One row of a column's menu. */
export type ColumnMenuAction = {
  label: string;
  icon: Component<{ class?: string }>;
  group: string;
  disabled?: boolean;
  /** A field the action shows, focused inside the tap so a phone raises its keyboard. */
  focuses?: string;
  run: () => void;
};

/** A column's menu as a host draws it in place of the header's dropdown. */
export type ColumnMenuProps = {
  column: DatabaseViewColumn;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: ColumnMenuAction[];
  /** A change to the column is being saved. */
  pending: boolean;
  /** Changing the type, when the viewer may. */
  types?: ColumnTypeMenuProps;
  /** The menu has closed; preventing the event keeps focus where the action put it. */
  onClosed: (event: Event) => void;
};

/** Present where a host draws column menus itself: a touch page uses a sheet. */
export const ColumnMenuContext = createContext<Component<ColumnMenuProps>>();

export function useColumnMenu(): Component<ColumnMenuProps> | undefined {
  return useContext(ColumnMenuContext);
}

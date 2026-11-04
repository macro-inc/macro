export type GridCellControl = {
  focus: () => void;
  edit: (seed?: string, options?: { selectAll?: boolean }) => void;
};

export type GridCellEditorOptions = {
  /** Mount cell popups inside this element, such as a modal dialog. */
  popupMount?: HTMLElement;
  initialEdit?: boolean;
  /** Keeps an inline editor within the displayed value's bounds. */
  preserveSize?: boolean;
  onEditorReady?: (focus: () => void) => void;
  onReady?: (control: GridCellControl | undefined) => void;
  onNavigate?: (direction: 1 | -1) => boolean;
  /** Edits the same column one row up or down; below the last row is the new-record row. */
  onNavigateRow?: (direction: 1 | -1) => boolean;
};

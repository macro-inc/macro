export type GridCellControl = {
  focus: () => void;
  edit: (seed?: string) => void;
};

export type GridCellEditorOptions = {
  initialEdit?: boolean;
  onEditorReady?: (focus: () => void) => void;
  onReady?: (control: GridCellControl | undefined) => void;
  onNavigate?: (direction: 1 | -1) => boolean;
  /** Edits the same column one row up or down; below the last row is the new-record row. */
  onNavigateRow?: (direction: 1 | -1) => boolean;
};

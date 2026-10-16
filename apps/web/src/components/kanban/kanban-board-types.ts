/** Query-free column identity and the host-ordered item IDs. */
export type KanbanBoardColumn = {
  id: string;
  label: string;
  itemIds: readonly string[];
};

/** Reveal virtualized columns and creation controls without owning host drafts. */
export type KanbanBoardControls = {
  revealColumn(id: string): void;
  revealFooter(id: string): void;
};

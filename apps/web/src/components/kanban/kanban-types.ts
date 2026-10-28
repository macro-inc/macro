export type KanbanDrop = {
  id: string;
  fromLane: string;
  toLane: string;
} & (
  | { kind: 'lane'; edge: 'before' | 'after' }
  | { kind: 'card'; beforeId?: string }
);

/** A column change leaves card order to the caller (for example, a sorted view). */
export type KanbanCrossColumnDrop = {
  kind: 'card';
  id: string;
  fromLane: string;
  toLane: string;
  beforeId?: string;
};

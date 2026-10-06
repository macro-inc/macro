/** Reader-facing structural data, independent of transport and app state. */
export type Side = 'old' | 'new';

export type SideText = {
  lines: string[];
  /** Flattened UTF-16 [start, end, syntax class] triples per line. */
  syntax: number[][];
  /** Flattened UTF-16 [start, end] pairs per line. */
  novel: number[][];
};

export type ReviewFile = {
  path: string;
  oldPath?: string | null;
  language?: string | null;
  status: string;
  added: number;
  removed: number;
  collapsed?: string | null;
  labels?: string[];
  old?: SideText | null;
  new?: SideText | null;
  rows: [number | null, number | null][];
  omitted?: string | null;
  details?: string[];
};

export type CodeLocation = {
  path: string;
  side: Side;
  line: number;
  endLine?: number | null;
};

export type Chapter = {
  title: string;
  description: string;
  paths: string[];
  focus: CodeLocation;
  note: string;
};

export type FileGroup = {
  key: string;
  title: string;
  files: string[];
  hidden?: boolean;
};

export type ReviewMessage = {
  id: string;
  author: string;
  delivery?: 'pending' | 'queued' | 'failed';
  body: string;
};

export type ReviewThread = {
  id: string;
  location: CodeLocation;
  resolved: boolean;
  outdated?: boolean;
  originalRevision?: number;
  originalLocation?: CodeLocation;
  excerpt?: string[];
  messages: ReviewMessage[];
};

/** Changes are given by the engine, not inferred again in the browser. */
export function isChanged(file: ReviewFile, row: ReviewFile['rows'][number]) {
  const [old, next] = row;
  return (
    old === null ||
    next === null ||
    (file.old?.novel[old]?.length ?? 0) > 0 ||
    (file.new?.novel[next]?.length ?? 0) > 0
  );
}

export type CodeRow = {
  old: number | null;
  new: number | null;
  changed: boolean;
  key: string;
};

/** A presentation change preserves the engine's alignment and token ranges. */
export function displayRows(file: ReviewFile, split: boolean): CodeRow[] {
  return file.rows.flatMap((row, index) => {
    const [old, next] = row;
    const changed = isChanged(file, row);
    if (split || !changed || old === null || next === null) {
      return [{ old, new: next, changed, key: String(index) }];
    }
    return [
      { old, new: null, changed, key: `${index}:old` },
      { old: null, new: next, changed, key: `${index}:new` },
    ];
  });
}

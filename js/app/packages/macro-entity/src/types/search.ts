export type WithSearch<T extends object> = T & {
  search: {
    nameHighlight: string | null;
    contentHighlights: string[] | null;
    source: 'local' | 'service';
  };
};

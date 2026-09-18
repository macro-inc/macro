/** Optional comments bridge. Draft/offline-only workbooks don't expose server comments. */
export type SpreadsheetCommentsCapability = {
  canComment: () => boolean;
  add: (cell: HTMLElement | undefined) => void;
  hasComment: (address: string) => boolean;
  enter: (address: string, cell: HTMLElement) => void;
  leave: () => void;
  show: (address: string, cell: HTMLElement) => void;
};

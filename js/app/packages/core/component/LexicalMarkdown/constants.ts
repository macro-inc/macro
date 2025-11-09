let layer = 0;

export const MarkdownStackingContext = {
  Base: layer++,
  Highlights: layer++,
  Decorators: layer++,
  Accessories: layer++,
} as const;

export enum MarkdownEditorErrors {
  EMPTY_SOURCE = 'EMPTY_SOURCE',
  JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
  VERSION_MISMATCH_ERROR = 'VERSION_MISMATCH_ERROR',
  STAGING_VERSION_MISMATCH_ERROR = 'STAGING_VERSION_MISMATCH_ERROR',
}

export const MarkdownEditorErrorDescriptions: Record<
  MarkdownEditorErrors,
  string
> = {
  [MarkdownEditorErrors.EMPTY_SOURCE]: 'No document content could be found.',
  [MarkdownEditorErrors.JSON_PARSE_ERROR]:
    'Parse error. Invalid document JSON.',
  [MarkdownEditorErrors.VERSION_MISMATCH_ERROR]:
    'Refresh the page to edit this document. It may have been updated using a newer version of Macro.',
  [MarkdownEditorErrors.STAGING_VERSION_MISMATCH_ERROR]:
    'This doc has been updated on an incompatible version of staging. If you are seeing this message, please open the document on staging to edit.',
};

export const getErrorDescription = (
  errorType: MarkdownEditorErrors
): string => {
  return MarkdownEditorErrorDescriptions[errorType];
};

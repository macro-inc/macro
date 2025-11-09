// EditMode is used to associate a document with specific stages in the editor lifecycle.
export const EditMode = {
  // Zen -_-
  Focus: 'Focus',
  // docx with track changes disabled
  Edit: 'Edit',
  // docx with track changes enabled
  Redline: 'Redline',
} as const;

// ViewMode is used to associate a document with specific stages in the viewer lifecycle.
export const ViewMode = {
  // permit adding signature field
  Pdf: 'Pdf',
  /** pdf with popups and annotation tools DISABLED FOR NOW*/
  View: 'View',
} as const;

/**
 * DocumentMode is a union of EditMode and ViewMode, representing all possible stages a document can be in.
 */
export const DocumentMode = {
  ...EditMode,
  ...ViewMode,
  Chat: 'Chat',
} as const;

export type EditModeType = keyof typeof EditMode;

export type ViewModeType = keyof typeof ViewMode;

export type DocumentModeType = EditModeType | ViewModeType | 'Chat';

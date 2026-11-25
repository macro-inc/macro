export default {
  // Navigation & sections
  myDrive: 'My Drive',
  recent: 'Recent',
  sharedWithMe: 'Shared with me',
  starred: 'Starred',
  trash: 'Trash',
  myFolders: 'My folders',
  sharedFolders: 'Shared folders',
  favorites: 'Favorites',
  databases: 'Databases',
  folders: 'Folders',
  driveRoot: 'Drive',
  browseMode: 'Browse',
  allFilesMode: 'All files',
  rootModeLabel: 'My Drive view mode',

  // View modes & display options
  viewModeLabel: 'View mode',
  viewList: 'List',
  viewGrid: 'Grid',
  viewColumns: 'Columns',
  foldersFirst: 'Folders first',
  showInspector: 'Show details and preview',
  hideInspector: 'Hide details and preview',
  quickLook: 'Quick Look',
  sortBy: 'Sort files',
  sortDirectionAsc: 'Ascending',
  sortDirectionDesc: 'Descending',
  viewOptions: 'View options',
  displayOptions: 'Display options',

  // Columns
  columnName: 'Name',
  columnLocation: 'Location',
  columnKind: 'Kind',
  columnOwner: 'Owner',
  columnModified: 'Modified',
  columnTrashed: 'Deleted',
  ownerYou: 'You',
  sharedLabel: 'Shared',
  unfiledLocation: 'My Drive',

  // File kind labels
  kindFolder: 'Folder',
  kindMarkdown: 'Document',
  kindPdf: 'PDF',
  kindImage: 'Image',
  kindVideo: 'Video',
  kindSpreadsheet: 'Spreadsheet',
  kindDatabase: 'Database',
  kindForm: 'Form',
  kindCode: 'Code',
  kindCanvas: 'Canvas',
  kindDocx: 'Word document',
  kindSnippet: 'Snippet',
  kindSkill: 'Skill',
  kindEmail: 'Email',
  kindChat: 'Chat',
  kindFile: 'File',

  // Folder & item counts
  subfolderCount: {
    one: '{{count}} subfolder',
    other: '{{count}} subfolders',
  },
  itemCount: {
    one: '{{count}} item',
    other: '{{count}} items',
  },
  folderCount: {
    one: '{{count}} folder',
    other: '{{count}} folders',
  },
  fileCount: {
    one: '{{count}} file',
    other: '{{count}} files',
  },
  selectedSummary: {
    one: '{{count}} item selected',
    other: '{{count}} items selected',
  },
  moreAncestors: 'Show parent folders',
  goToParentFolder: 'Go to parent folder',

  // Time buckets (Recent)
  bucketToday: 'Today',
  bucketYesterday: 'Yesterday',
  bucketThisWeek: 'This week',
  bucketEarlier: 'Earlier',

  // Creation & inline editing
  newFolderInline: 'New folder',
  newSubfolder: 'New subfolder',
  newSubfolderIn: 'New subfolder in {{name}}',
  newFolderWithFiles: 'New folder with files…',
  folderNamePlaceholder: 'Untitled folder',
  renameInputLabel: 'Rename {{name}}',
  newFolderInputLabel: 'New folder name',
  inlineRenameHint: 'Press Enter to save, Esc to cancel',
  createDocument: 'New document',
  uploadFiles: 'Upload files',
  uploadFolder: 'Upload folder',
  expandFolder: 'Expand {{name}}',
  collapseFolder: 'Collapse {{name}}',

  // Search & filters
  searchDrivePlaceholder: 'Search Drive',
  searchFolderPlaceholder: 'Search in {{name}}',
  searchTrashPlaceholder: 'Search Trash',
  searchStarredPlaceholder: 'Search Starred',
  searchingInFolder: 'Searching inside {{name}}',
  searchAllDrive: 'Search all of Drive',
  clearSearch: 'Clear search',
  clearAllFilters: 'Clear all',
  activeFilterRemove: 'Remove {{label}} filter',
  filterTypeLabel: 'Type',
  filterTagLabel: 'Tag',
  filterCreatorLabel: 'Creator',
  filterScopeAll: 'All files',
  filterScopeAttachments: 'Email attachments',

  // Drag & drop
  dropToMoveHere: {
    one: 'Drop to move {{count}} item into {{destination}}',
    other: 'Drop to move {{count}} items into {{destination}}',
  },
  dropFilesHere: 'Drop files or folders to upload to {{destination}}',

  // Bulk & item actions
  move: 'Move',
  star: 'Star',
  unstar: 'Unstar',
  share: 'Share',
  duplicate: 'Duplicate',
  rename: 'Rename',
  moveToTrash: 'Move to Trash',
  restore: 'Restore',
  restoreSelected: {
    one: 'Restore {{count}} item',
    other: 'Restore {{count}} items',
  },
  deleteForever: 'Delete forever',
  deleteForeverConfirmTitle: {
    one: 'Delete permanently?',
    other: 'Delete {{count}} items permanently?',
  },
  deleteForeverConfirmDescription:
    'This cannot be undone. Deleted folders permanently remove the documents and chats inside them.',
  emptyTrash: 'Empty Trash',
  emptyTrashConfirmTitle: 'Empty Trash?',
  emptyTrashConfirmDescription: {
    one: 'Permanently delete {{count}} item in Trash? This cannot be undone.',
    other:
      'Permanently delete {{count}} items in Trash? This cannot be undone.',
  },
  openFullView: 'Open',
  openInNewSplit: 'Open in split',
  openFolder: 'Open folder',
  moreActions: 'More actions',
  backToDrive: 'Back to My Drive',
  backToParent: 'Up to {{name}}',

  // Inspector / Quick Look
  inspectorTitle: 'Details',
  inspectorPreviewTab: 'Preview',
  inspectorDetailsTab: 'Details',
  inspectorNoSelection: 'Select a file or folder to inspect it',
  inspectorNoSelectionHint: 'Press Space on any item for Quick Look.',
  inspectorLocation: 'Location',
  inspectorOwner: 'Owner',
  inspectorModified: 'Modified',
  inspectorCreated: 'Created',
  inspectorViewed: 'Last viewed',
  inspectorKind: 'Kind',
  inspectorTags: 'Tags',
  inspectorContents: 'Contents',
  inspectorFolderEmpty: 'This folder has no items yet.',
  inspectorMultiHint: 'Use the actions below to organize this selection.',
  inspectorClose: 'Close preview',

  // Undo & action toasts
  toastMoved: {
    one: 'Moved to {{destination}}',
    other: 'Moved {{count}} items to {{destination}}',
  },
  toastMovedToRoot: {
    one: 'Moved to My Drive',
    other: 'Moved {{count}} items to My Drive',
  },
  toastTrashed: {
    one: 'Moved to Trash',
    other: 'Moved {{count}} items to Trash',
  },
  toastRestored: {
    one: 'Restored from Trash',
    other: 'Restored {{count}} items from Trash',
  },
  toastDeletedForever: {
    one: 'Permanently deleted',
    other: 'Permanently deleted {{count}} items',
  },
  toastMoveUndone: {
    one: 'Move undone',
    other: 'Moved {{count}} items back',
  },
  toastRenameUndone: 'Rename undone',
  toastUndoFailed: 'Could not undo that change',
  toastRestoreFailed: 'Could not restore from Trash',
  toastDeleteForeverFailed: 'Could not permanently delete',
  toastTrashFailed: 'Could not move to Trash',
  toastFolderCreateFailed: 'Could not create folder',
  toastDatabaseMovedToFolder: 'Created in {{destination}}',

  // Empty & loading states
  emptyMyDriveTitle: 'Your Drive is ready',
  emptyMyDriveDescription:
    'Create a document, organize work in folders, or drop files from your computer.',
  emptyFolderTitle: 'This folder is empty',
  emptyFolderDescription:
    'Create a document or subfolder, or drop files here to add them.',
  emptySharedTitle: 'Nothing shared with you yet',
  emptySharedDescription:
    'Files and folders teammates share with you will appear here.',
  emptyRecentTitle: 'No recent files yet',
  emptyRecentDescription:
    'Documents and files you view or edit will appear here for quick access.',
  emptyStarredTitle: 'No starred items yet',
  emptyStarredDescription:
    'Star important files and folders to keep them one click away.',
  emptyTrashTitle: 'Trash is empty',
  emptyTrashDescription:
    'Items you move to Trash stay here until you restore or permanently delete them.',
  emptySearchTitle: 'No matching files',
  emptySearchDescription: 'Try another search term or clear your filters.',
  emptyFilterTitle: 'No files match these filters',
  emptyFilterDescription: 'Try clearing or broadening your active filters.',
  loadingTrash: 'Loading Trash…',
  loadingMore: 'Loading more…',
  trashLoadFailed: 'Trash couldn’t be loaded.',
  tryAgain: 'Try again',
  loadMore: 'Load more',

  // Columns view
  columnRootTitle: 'My Drive',
  columnEmpty: 'Empty folder',
  columnPreviewHeading: 'Preview',
};

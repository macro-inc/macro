export type FolderUpload = { file: File; isFolder: boolean };

export type FolderDraft = {
  name: string;
  tags: Record<string, string[]>;
  files: FolderUpload[];
  createdId?: string;
  error?: string;
};

export type FolderCreationCommands = {
  create(name: string): Promise<string>;
  saveTags(id: string, tags: Record<string, string[]>): Promise<void>;
  upload(id: string, file: FolderUpload): Promise<void>;
};

/** Owned by the host after it dismisses the submitted composer. */
export type FolderSubmission = {
  result: Promise<
    | { type: 'created'; id: string; name: string }
    | { type: 'failed'; draft: FolderDraft }
  >;
};

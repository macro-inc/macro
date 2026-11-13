/**
 * The parsed export as `crates/password_import_wasm` serializes it. Items and
 * folders are already in the vault import batch shapes.
 */

export type ImportFormat =
  | 'one_password_pux'
  | 'one_password_csv'
  | 'bitwarden_json'
  | 'bitwarden_csv';

export type ImportItemKind =
  | 'login'
  | 'card'
  | 'note'
  | 'identity'
  | 'api'
  | 'verification_code';

/** Why a whole file can't be read, as `password_import::ImportError`. */
export type ImportFileError =
  | {
      code:
        | 'unknown_format'
        | 'too_large'
        | 'zip_bomb'
        | 'too_many_entries'
        | 'too_many_items'
        | 'path_traversal'
        | 'invalid_zip'
        | 'missing_export_data'
        | 'encrypted_bitwarden'
        | 'unsupported_version';
    }
  | { code: 'invalid_json'; line: number }
  | { code: 'invalid_csv'; row: number };

export type ImportSkipReason =
  | 'trashed'
  | 'archived'
  | 'attachment'
  | 'passkey'
  | 'shared_collection'
  | 'unsupported_category'
  | 'too_large'
  | 'malformed';

export type ImportDroppedPart =
  | 'attachment'
  | 'passkey'
  | 'password_history'
  | 'totp_non_default'
  | 'extra_field';

/** A source folder, keyed `folder:<index>`, parents before children. */
export type ParsedImportFolder = {
  key: string;
  name: string;
  parentKey: string | null;
  /** Segments from the top level down. */
  path: string[];
};

/** One item, in `PasswordImportItem` shape. Holds revealed values. */
export type ParsedImportItem = {
  sourceKey: string;
  name: string;
  kind: ImportItemKind;
  url: string | null;
  folderKey: string | null;
  favorite: boolean;
  values: {
    username: string;
    password: string;
    notes: string;
    fields: { label: string; value: string }[];
  };
  totp: string | null;
};

export type ParsedImport = {
  format: ImportFormat;
  summary: {
    itemsByKind: Partial<Record<ImportItemKind, number>>;
    folders: number;
    skippedByReason: Partial<Record<ImportSkipReason, number>>;
    droppedByPart: Partial<Record<ImportDroppedPart, number>>;
  };
  folders: ParsedImportFolder[];
  items: ParsedImportItem[];
  skipped: {
    sourceKey: string | null;
    name: string | null;
    reason: ImportSkipReason;
  }[];
  dropped: { sourceKey: string; what: ImportDroppedPart; count: number }[];
};

export type ParseOutcome =
  | { outcome: 'parsed'; export: ParsedImport }
  | { outcome: 'failed'; error: ImportFileError };

export type DetectOutcome =
  | { outcome: 'detected'; format: ImportFormat }
  | { outcome: 'failed'; error: ImportFileError };

/**
 * What the import worker answers; `unreadable` means the parser itself failed.
 * A parsed file comes with the SHA-256 of its bytes (hex), which identifies the
 * file without keeping any of it.
 */
export type ParseReply =
  | { outcome: 'parsed'; export: ParsedImport; fileHash: string }
  | { outcome: 'failed'; error: ImportFileError }
  | { outcome: 'unreadable' };

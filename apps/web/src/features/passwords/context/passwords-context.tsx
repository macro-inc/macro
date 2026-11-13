import type {
  ImportFileError,
  ImportFormat,
  ParsedImport,
  ParsedImportItem,
  ParseReply,
} from '@core/password-import/types';
import type { PasswordImportErrorCode } from '@service-storage/generated/schemas/passwordImportErrorCode';
import type { PasswordImportOutcome } from '@service-storage/generated/schemas/passwordImportOutcome';
import type { Result } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type {
  DuplicateCheck,
  ImportFailureReason,
  ImportTarget,
} from '../core/import';
import type {
  PasswordActivity,
  PasswordDraft,
  PasswordFolder,
  PasswordGrant,
  PasswordItem,
  PasswordRecipient,
  PasswordValues,
  PasswordVersion,
} from '../core/types';

export type PasswordFailure = 'forbidden' | 'folderMissing' | 'failed';
export type PasswordResult<T> = Promise<Result<T, PasswordFailure>>;
export type PasswordSource = {
  list(): Promise<PasswordItem[]>;
  /**
   * Items whose lower-cased name is one of `names` (already trimmed and lower
   * case), metadata only, at most 500; the names go in a request body, never a URL.
   */
  matchNames(names: string[]): PasswordResult<PasswordItem[]>;
  folders(): Promise<PasswordFolder[]>;
  save(
    id: string | undefined,
    version: number | undefined,
    draft: PasswordDraft,
    operationId: string
  ): PasswordResult<PasswordItem>;
  move(
    item: PasswordItem,
    folderId: string | null
  ): PasswordResult<PasswordItem>;
  grants(id: string): PasswordResult<PasswordGrant[]>;
  remove(id: string): PasswordResult<void>;
  username(id: string): PasswordResult<{ username: string; version: number }>;
  copyUsername(
    id: string
  ): PasswordResult<{ username: string; version: number }>;
  reveal(
    id: string,
    version?: number
  ): PasswordResult<{ values: PasswordValues; version: number }>;
  copy(id: string): PasswordResult<{ values: PasswordValues; version: number }>;
  history(id: string): PasswordResult<PasswordVersion[]>;
  activity(id: string): PasswordResult<PasswordActivity[]>;
  share(id: string, grants: PasswordGrant[]): PasswordResult<void>;
  createFolder(
    name: string,
    parentId: string | null
  ): PasswordResult<PasswordFolder>;
  renameFolder(id: string, name: string): PasswordResult<PasswordFolder>;
  moveFolder(
    id: string,
    parentId: string | null
  ): PasswordResult<PasswordFolder>;
  deleteFolder(id: string): PasswordResult<void>;
  setTotp(id: string, key: string): PasswordResult<void>;
  removeTotp(id: string): PasswordResult<void>;
  totp(
    id: string
  ): PasswordResult<{ code: string; validUntil: string; period: number }>;
  logo(domain: string): PasswordResult<string>;
  /** One import batch; item ids derive from `importId` and each source key. */
  importBatch(
    importId: string,
    batch: ImportBatchBody
  ): Promise<Result<ImportBatchResult, ImportRequestFailure>>;
};
/** One request to `POST …/imports/{importId}/items`; checked against `PasswordImportBatch`. */
export type ImportBatchBody = {
  format: ImportFormat;
  target: ImportTarget;
  private: boolean;
  folders: { key: string; name: string; parentKey: string | null }[];
  items: ParsedImportItem[];
};
export type ImportItemOutcome = PasswordImportOutcome;
export type ImportErrorCode = PasswordImportErrorCode;
/** A batch request that failed as a whole: why, and whether to resend it. */
export type ImportRequestFailure = {
  retryable: boolean;
  reason: ImportFailureReason;
};
/** Per-item outcomes, never values; mapped from `PasswordImportBatchResult`. */
export type ImportBatchResult = {
  targetFolderId: string | null;
  folders: { key: string; folderId: string }[];
  items: {
    sourceKey: string;
    outcome: ImportItemOutcome;
    errorCode?: ImportErrorCode;
    itemId?: string;
  }[];
};
/** A file that could not be read: the parser's reason, or the parser failed. */
export type ImportFileFailure = ImportFileError | { code: 'unreadable' };
/** Where the import goes: a new folder, an existing one, or the vault root. */
export type ImportDestination = 'new' | 'root' | `folder:${string}`;
/** What the import preview shows; names but no values. */
export type ImportPreview = {
  format: ImportFormat;
  summary: ParsedImport['summary'];
  itemCount: number;
  folders: ParsedImport['folders'];
  skipped: ParsedImport['skipped'];
  dropped: ParsedImport['dropped'];
  duplicates: number;
  /**
   * How far duplicates were checked: against the whole vault, a capped
   * answer that may leave some out, or not at all because the vault could
   * not be asked.
   */
  duplicateCheck: DuplicateCheck;
  /** An earlier, unfinished import of this file is being continued. */
  resumed: boolean;
  /** An earlier import of this file was dropped: the folder it used is gone. */
  restarted: boolean;
  newFolderName: string;
};
/**
 * An unfinished import, kept per file so a rerun continues it with the same
 * destination and privacy. Ids only: source keys and item ids, never names.
 */
export type ImportResume = {
  importId: string;
  format: ImportFormat;
  startedAt: string;
  destination: ImportDestination;
  private: boolean;
  /**
   * Source keys whose item this import may have created without finishing:
   * failed with an item id (its verification code, say), with that id, or
   * a verification-code item sent without an answer yet (null). A rerun
   * resends them rather than skipping them as duplicates.
   */
  unfinished: Record<string, string | null>;
};
export type ImportResumeStore = {
  get(key: string): ImportResume | undefined;
  set(key: string, value: ImportResume): void;
  remove(key: string): void;
};
/**
 * One viewer's vault: account, sign-in session and team. A new sign-in, even
 * to the same account, is a new scope; work started under an old scope never
 * completes into the new one.
 */
export type PasswordScope = {
  key: string;
  isCurrent: () => boolean;
};
export type PasswordCapabilities = {
  scope: PasswordScope;
  source: PasswordSource;
  recipients: Accessor<PasswordRecipient[]>;
  recipientsLoading: Accessor<boolean>;
  recipientsError: Accessor<boolean>;
  writeClipboard(value: string): Promise<void>;
  /** Parses an export file in the browser; the file is never uploaded. */
  parseExport(file: File): Promise<ParseReply>;
  importResume: ImportResumeStore;
};
const PasswordsContext = createContext<PasswordCapabilities>();
export function PasswordsProvider(
  props: ParentProps<{ value: PasswordCapabilities }>
) {
  return (
    <PasswordsContext.Provider value={props.value}>
      {props.children}
    </PasswordsContext.Provider>
  );
}
export function usePasswords() {
  const value = useContext(PasswordsContext);
  if (!value) throw new Error('PasswordsProvider is required');
  return value;
}

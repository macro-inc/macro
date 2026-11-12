import type { ImportFormat, ParseReply } from '@core/password-import/types';
import type { Result } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { ImportBatchBody, ImportBatchResult } from '../core/import';
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
  /** Metadata search (names and websites, never values), capped like `list`. */
  search(text: string): PasswordResult<PasswordItem[]>;
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
  ): PasswordResult<ImportBatchResult>;
};
/** An unfinished import, kept per file so a rerun continues it. Ids only. */
export type ImportResume = {
  importId: string;
  format: ImportFormat;
  startedAt: string;
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

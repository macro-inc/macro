import type { Result } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
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

export type PasswordFailure = 'reauth' | 'forbidden' | 'failed';
export type PasswordResult<T> = Promise<Result<T, PasswordFailure>>;
export type PasswordSource = {
  list(): Promise<PasswordItem[]>;
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
  reveal(
    id: string,
    version?: number
  ): PasswordResult<{ values: PasswordValues; version: number }>;
  copy(id: string): PasswordResult<{ values: PasswordValues; version: number }>;
  history(id: string): PasswordResult<PasswordVersion[]>;
  activity(id: string): PasswordResult<PasswordActivity[]>;
  share(id: string, grants: PasswordGrant[]): PasswordResult<void>;
  createFolder(name: string): PasswordResult<PasswordFolder>;
  setTotp(id: string, key: string): PasswordResult<void>;
  removeTotp(id: string): PasswordResult<void>;
  totp(id: string): PasswordResult<{ code: string; validUntil: string }>;
  logo(domain: string): PasswordResult<string>;
};
export type PasswordCapabilities = {
  source: PasswordSource;
  recipients: Accessor<PasswordRecipient[]>;
  recipientsLoading: Accessor<boolean>;
  recipientsError: Accessor<boolean>;
  writeClipboard(value: string): Promise<void>;
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

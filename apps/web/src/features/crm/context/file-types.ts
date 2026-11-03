import type { DocumentEntity } from '@entity';
import type { Accessor } from 'solid-js';
import type { FileClassification, FileTypeCatalog } from '../core/file-types';
import type { CrmRecordTarget } from '../core/record';

export type FileRead<T> = {
  data: Accessor<T | undefined>;
  pending: Accessor<boolean>;
  error: Accessor<boolean>;
  refresh(): Promise<unknown>;
};

export type FileTypesSource = FileRead<FileTypeCatalog | null> & {
  /** Multi-step writes stop if the signed-in user or team changes. */
  sessionKey: Accessor<string | undefined>;
  /** Team property options follow the shared property service's member permission. */
  canManage: Accessor<boolean>;
  initialize(): Promise<void>;
  add(name: string): Promise<void>;
  rename(optionId: string, name: string): Promise<void>;
  remove(optionId: string): Promise<void>;
  classify(documentId: string, optionId: string | null): Promise<void>;
  classifications(
    ids: Accessor<string[]>
  ): FileRead<Map<string, FileClassification>>;
  canEdit(documentId: Accessor<string>): Accessor<boolean>;
  candidates(query: Accessor<string>): {
    files: Accessor<DocumentEntity[]>;
    pending: Accessor<boolean>;
    hasMore: Accessor<boolean>;
    loadMore(): Promise<void>;
    error: Accessor<unknown>;
  };
  /** Only creates the document; callers retain its id before linking so retries reuse it. */
  create(name: string): Promise<string>;
  attach(documentId: string, record: CrmRecordTarget): Promise<void>;
};

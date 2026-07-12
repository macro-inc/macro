import type { FetchError } from '@core/service';

export type StorageError =
  | 'OPFS_ERROR'
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'INVALID_MODIFICATION_DATA'
  | FetchError;

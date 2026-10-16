export enum LoroManagerError {
  ImportFailed = 'IMPORT_FAILED',
  /** The update arrived ahead of its causal dependencies. Loro holds it and
   *  applies it automatically once the gap fills — not a failure. */
  ImportPending = 'IMPORT_PENDING',
  NotInitialized = 'NOT_INITIALIZED',
  InitializeFailed = 'INITIALIZE_FAILED',
  SyncFailed = 'SYNC_FAILED',
  ExportFailed = 'EXPORT_FAILED',
  GetCursorPosFailed = 'GET_CURSOR_POS_FAILED',
  GetContainerByIdFailed = 'GET_CONTAINER_BY_ID_FAILED',
  UnknownLoroError = 'UNKNOWN_LORO_ERROR',
}

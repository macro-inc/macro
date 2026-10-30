/**
 * Error code `init` returns when the target mailbox is already connected by another
 * macro user. The caller confirms with the user, then retries with `forceShare`.
 */
export const SHARED_INBOX_CONFLICT_CODE = 'SHARED_INBOX_CONFLICT' as const;

/** Error code `init` returns (HTTP 400) when the inbox is already provisioned. */
export const ALREADY_INITIALIZED_CODE = 'ALREADY_INITIALIZED' as const;

/**
 * Error code `init` returns (HTTP 400) when the user holds no Gmail grant to
 * provision from — the Gmail scope was declined at consent or the grant was
 * removed. The add-inbox flow re-runs consent and clears it.
 */
export const NO_GMAIL_GRANT_CODE = 'NO_GMAIL_GRANT' as const;

/**
 * Error code `patchSettings` returns (HTTP 422) when a signature has images that
 * couldn't be fetched/rehosted and would render broken for recipients. The whole
 * patch is rejected; the error message carries the count so the UI can prompt a
 * re-add.
 */
export const SIGNATURE_IMAGES_UNRESOLVED_CODE =
  'SIGNATURE_IMAGES_UNRESOLVED' as const;

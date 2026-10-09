/**
 * Legacy binary Office uploads (.doc, .ppt, .xls) are upgraded to OpenXML on
 * the server shortly after upload. While that runs the document still has its
 * legacy file type and opens here; these helpers decide whether to wait for
 * the upgrade and detect when it lands.
 */

export type UpgradedOfficeType = 'docx' | 'pptx' | 'xlsx';

const UPGRADE_TARGETS: Record<string, UpgradedOfficeType> = {
  doc: 'docx',
  ppt: 'pptx',
  xls: 'xlsx',
};

const UPGRADE_LABELS: Record<UpgradedOfficeType, string> = {
  docx: 'Word document',
  pptx: 'PowerPoint presentation',
  xlsx: 'Excel workbook',
};

/** Documents older than this were uploaded before upgrades or failed them. */
export const LEGACY_UPGRADE_WINDOW_MS = 10 * 60 * 1000;

export function legacyOfficeUpgradeTarget(
  fileType: string | null | undefined
): UpgradedOfficeType | undefined {
  return fileType ? UPGRADE_TARGETS[fileType.toLowerCase()] : undefined;
}

export function upgradedOfficeLabel(target: UpgradedOfficeType): string {
  return UPGRADE_LABELS[target];
}

/** Whether an upgrade for this document may still be on its way. */
export function shouldAwaitLegacyUpgrade(
  document: { fileType?: string | null; createdAt?: string | null },
  now: number
): boolean {
  if (!legacyOfficeUpgradeTarget(document.fileType)) return false;
  if (!document.createdAt) return false;
  const created = Date.parse(document.createdAt);
  if (Number.isNaN(created)) return false;
  return now - created < LEGACY_UPGRADE_WINDOW_MS;
}

export type PollForUpgradeOptions<M> = {
  target: UpgradedOfficeType;
  fetchMetadata: () => Promise<M>;
  fileTypeOf: (metadata: M) => string | null | undefined;
  sleep: (ms: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  signal?: AbortSignal;
};

/**
 * Polls document metadata until its file type becomes `target`. Resolves with
 * that metadata, or `undefined` on timeout or abort. Failed requests are
 * retried until the timeout.
 */
export async function pollForLegacyUpgrade<M>(
  options: PollForUpgradeOptions<M>
): Promise<M | undefined> {
  const {
    target,
    fetchMetadata,
    fileTypeOf,
    sleep,
    intervalMs = 3_000,
    timeoutMs = 3 * 60 * 1000,
    now = Date.now,
    signal,
  } = options;
  const deadline = now() + timeoutMs;

  while (!signal?.aborted && now() < deadline) {
    try {
      const metadata = await fetchMetadata();
      if (fileTypeOf(metadata)?.toLowerCase() === target) return metadata;
    } catch {
      // Keep waiting: a transient failure should not end the wait.
    }
    if (signal?.aborted) break;
    await sleep(intervalMs);
  }
  return undefined;
}

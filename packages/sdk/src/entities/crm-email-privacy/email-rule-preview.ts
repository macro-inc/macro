import type { EmailPreviewView } from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';

/** Counts concern this member's mailbox copies, never team-wide conversations. */
export type CrmEmailPreviewState = {
  /** Only complete means exact counts; partial and running counts are lower bounds. */
  status: EmailPreviewView['status'];
  /** Distinct threads: current, proposed, added, removed, retained and denied. */
  counts: EmailPreviewView['counts'];
  /** Stable snapshot time, absent until a worker starts. */
  asOf?: string;
  /** Worker attempt identity; compare before combining observations. */
  contextId: EmailPreviewView['context_id'];
  /** Preview enqueue time. */
  createdAt: string;
  /** Five-minute work deadline, not a promise of a complete result. */
  expiresAt: string;
  /** Raw threads examined so far. */
  scannedThreads: number;
};

function previewState(record: EmailPreviewView): CrmEmailPreviewState {
  return {
    status: record.status,
    counts: record.counts,
    asOf: record.as_of ?? undefined,
    contextId: record.context_id,
    createdAt: record.created_at,
    expiresAt: record.expires_at,
    scannedThreads: record.scanned_threads,
  };
}

/** An exact preview slot occupant; a replaced handle never follows newer work. */
export class CrmEmailRulePreview {
  private readVersion = 0;

  private constructor(
    private readonly client: MacroClient,
    readonly id: string,
    private snapshot?: CrmEmailPreviewState,
  ) {}

  /** Reconstruct a handle; a subsequent read verifies it is still current. */
  static byId(client: MacroClient, id: string): CrmEmailRulePreview {
    return new CrmEmailRulePreview(client, id);
  }

  /** @internal Preserve the preview identity and the response already received. */
  static from(
    client: MacroClient,
    record: EmailPreviewView,
  ): CrmEmailRulePreview {
    return new CrmEmailRulePreview(
      client,
      record.preview_id,
      previewState(record),
    );
  }

  /**
   * Refresh this preview's counts; only complete is exact, and a replaced preview is unavailable.
   * Cancelled and stale counts are not current estimates. No polling or implicit restart.
   *
   * @readonly
   */
  async get(): Promise<CrmEmailPreviewState> {
    const version = ++this.readVersion;
    const record = unwrap(await this.client.storage.getCrmEmailRulePreview());
    if (!record || record.preview_id !== this.id) {
      if (version === this.readVersion) this.snapshot = undefined;
      throw new MacroNotFoundError(
        'Email rule preview was replaced or is unavailable.',
      );
    }
    const state = previewState(record);
    if (version === this.readVersion) this.snapshot = state;
    return state;
  }

  /**
   * Cancel only this preview; consent is unchanged and newer preview work is never cancelled.
   *
   * @destructive
   * @idempotent
   */
  async cancel(): Promise<void> {
    unwrap(
      await this.client.storage.cancelCrmEmailRulePreview({
        path: { preview_id: this.id },
      }),
    );
    this.readVersion++;
    this.snapshot = undefined;
  }

  toJSON() {
    return { id: this.id, ...this.snapshot };
  }
}

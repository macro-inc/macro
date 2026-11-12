import type {
  CreatePipeline,
  PipelineEntries,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Company } from './company';
import type { Contact } from './contact';
import { CrmPipeline } from './pipeline';
import { PipelineEntry } from './pipeline-entry';

/** CRM pipelines in the caller's team. */
export class PipelineNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy pipeline handle. */
  byId(id: string): CrmPipeline {
    return CrmPipeline.byId(this.client, id);
  }

  /**
   * List accessible pipelines.
   *
   * @readonly
   */
  async list(): Promise<CrmPipeline[]> {
    return unwrap(await this.client.storage.listCrmPipelines()).map((p) =>
      CrmPipeline.from(this.client, p),
    );
  }

  /**
   * Create a pipeline and its backing storage.
   *
   * @write
   */
  async create(options: CreatePipeline): Promise<CrmPipeline> {
    return CrmPipeline.from(
      this.client,
      unwrap(await this.client.storage.createCrmPipeline({ body: options })),
    );
  }

  /**
   * Every entry (deal) tracking one of these companies or contacts, across
   * the caller's pipelines; pipelines without one are left out.
   *
   * @readonly
   */
  async entriesFor(
    records: (Company | Contact)[],
  ): Promise<{ pipeline: CrmPipeline; entries: PipelineEntry[] }[]> {
    const groups = unwrap(
      await this.client.storage.listCrmRecordPipelineEntries({
        body: { recordIds: records.map((record) => record.id) },
      }),
    );
    return groups.map((group) => this.entries(group));
  }

  /**
   * Entries (deals) whose company or contact name, domain or email contains
   * `search`, across the caller's pipelines; pipelines without a match are
   * left out.
   *
   * @param opts.limit Most entries per pipeline, 1 to 5000 (default 50).
   *
   * @readonly
   */
  async searchEntries(
    search: string,
    opts: { limit?: number } = {},
  ): Promise<{ pipeline: CrmPipeline; entries: PipelineEntry[] }[]> {
    const groups = unwrap(
      await this.client.storage.searchCrmPipelineEntries({
        query: { search, limit: opts.limit },
      }),
    );
    return groups.map((group) => this.entries(group));
  }

  private entries(group: PipelineEntries): {
    pipeline: CrmPipeline;
    entries: PipelineEntry[];
  } {
    const pipeline = CrmPipeline.from(this.client, group.pipeline);
    return {
      pipeline,
      entries: group.entries.map((entry) =>
        PipelineEntry.from(
          this.client,
          pipeline,
          group.pipeline.recordType,
          entry,
        ),
      ),
    };
  }
}

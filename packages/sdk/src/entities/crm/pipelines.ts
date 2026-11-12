import type {
  CreatePipelineRequest,
  PipelineEntries,
} from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Company } from './company';
import type { Contact } from './contact';
import { CrmPipeline } from './pipeline';
import { PipelineEntry, type PipelineField } from './pipeline-entry';

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
   * List accessible pipelines with each one's fields in column order and its
   * version, in one call. A select field lists its options, so Stage lists the
   * pipeline's stages from first to last; a tracked pipeline's first field
   * names its company or contact. Use it instead of reading each pipeline's
   * table or running a `find` per pipeline just to learn its fields.
   *
   * @readonly
   */
  async listWithFields(): Promise<
    { pipeline: CrmPipeline; fields: PipelineField[]; version: number }[]
  > {
    return unwrap(await this.client.storage.listCrmPipelineDetails()).map(
      ({ fields, version, ...record }) => ({
        pipeline: CrmPipeline.from(this.client, record),
        fields,
        version,
      }),
    );
  }

  /**
   * Create a pipeline. A company or contact pipeline starts with its record,
   * Stage, Owner and Revenue fields; a generic one (no `recordType`) with
   * only Name. `stages` (first to last) replaces the team's default stages,
   * or adds a Stage field to a generic pipeline; `fields` are added after the
   * standard ones. Private unless `sharing` is `team`.
   *
   * @example
   * await macro.crm.pipelines.create({
   *   name: 'Hiring',
   *   recordType: 'contact',
   *   stages: ['Sourced', 'Interview', 'Offer', 'Hired'],
   *   fields: [{ name: 'Role', type: 'select', options: ['Engineer', 'Designer'] }],
   * });
   *
   * @write
   */
  async create(options: CreatePipelineRequest): Promise<CrmPipeline> {
    return CrmPipeline.from(
      this.client,
      unwrap(
        await this.client.storage.createCrmPipelineWithFields({
          body: options,
        }),
      ),
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

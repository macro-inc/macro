import type {
  AccessiblePipeline,
  CardPosition,
  ColumnDetail,
  CreatePipeline,
  DatabaseOp,
  DatabaseView as DatabaseViewRecord,
  EditPipelineRequest,
  OpBatch,
  StorageRow,
  StorageRowsQuery,
  TableDetail,
} from '../../../generated/storage/types.gen';
import { Lazy, MacroNotFoundError, paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Document } from '../documents/document';
import { MacroEntity } from '../entity';
import { PropertyOption } from '../properties/property-option';
import {
  type SharePermissionOptions,
  sharePermissionBody,
} from '../sharing/permissions';
import { Team } from '../teams/team';
import { User } from '../users/user';
import { Company } from './company';
import { Contact } from './contact';
import {
  fieldChange,
  fieldInputs,
  PipelineEntry,
  type PipelineField,
  type PipelineFieldChange,
  type PipelineFieldInputs,
  type PipelineFieldTotal,
  type PipelineImport,
  type PipelineOptionCounts,
  type PipelineRecordInput,
  pipelineImport,
} from './pipeline-entry';

/** Required fields for one option of a pipeline stage column. */
export type PipelineStageRequirement = {
  stageColumn: PipelineColumn;
  stage: PropertyOption;
  requiredFields: PipelineColumn[];
};

/** A CRM pipeline with its own sharing boundary and backing table. */
export class CrmPipeline extends MacroEntity<AccessiblePipeline> {
  private readonly tableDetail = new Lazy(async () =>
    unwrap(
      await this.client.storage.getCrmPipelineTable({ path: { id: this.id } }),
    ),
  );

  /** Construct a lazy pipeline handle. */
  static byId(client: MacroClient, id: string): CrmPipeline {
    return new CrmPipeline(client, id);
  }

  /** Seed from a server record. */
  static from(client: MacroClient, record: AccessiblePipeline): CrmPipeline {
    return new CrmPipeline(client, record.id, record);
  }

  protected async fetch(): Promise<AccessiblePipeline> {
    return unwrap(
      await this.client.storage.getCrmPipeline({ path: { id: this.id } }),
    );
  }

  /** Display name. */
  readonly name = this.field('name');

  /** CRM record type. */
  readonly recordType = this.field('recordType');

  /** Current caller's access level. */
  readonly accessLevel = this.field('grant');

  /** Sharing scope. */
  readonly sharing = this.field('sharing');

  /** Owner. */
  readonly owner = this.mappedField('userId', (id) =>
    User.byId(this.client, id),
  );

  /** Owning team. */
  readonly team = this.mappedField('teamId', (id) =>
    Team.byId(this.client, id),
  );

  /**
   * Rename this pipeline.
   *
   * @write
   * @idempotent
   */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.renameCrmPipeline({ path: { id: this.id }, body: { name } }),
    );
  }

  /**
   * Change its sharing scope.
   *
   * @write
   * @idempotent
   */
  async setSharing(sharing: CreatePipeline['sharing']): Promise<void> {
    if (sharing === undefined) throw new Error('Sharing is required');
    await this.mutate((c) =>
      c.storage.shareCrmPipeline({ path: { id: this.id }, body: { sharing } }),
    );
  }

  /**
   * Trash or restore the pipeline.
   *
   * @destructive
   * @idempotent
   */
  async setTrashed(trashed: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.trashCrmPipeline({ path: { id: this.id }, body: { trashed } }),
    );
  }

  /**
   * Read sharing grants.
   *
   * @readonly
   */
  async sharePermissions() {
    return unwrap(
      await this.client.storage.getCrmPipelinePermissions({
        path: { id: this.id },
      }),
    );
  }

  /**
   * Update sharing grants.
   *
   * @write
   * @idempotent
   */
  async updateSharePermissions(options: SharePermissionOptions) {
    return this.mutate((c) =>
      c.storage.updateCrmPipelinePermissions({
        path: { id: this.id },
        body: sharePermissionBody(options),
      }),
    );
  }

  /**
   * Read stage rules with column and option handles that survive renames.
   *
   * @readonly
   */
  async stageRequirements(): Promise<PipelineStageRequirement[]> {
    const rules = unwrap(
      await this.client.storage.getCrmPipelineStageRequirements({
        path: { id: this.id },
      }),
    );
    // Rules are read fresh; resolve their identities against a fresh schema too.
    this.tableDetail.clear();
    const table = await this.table();
    const detail = await this.tableRecord();
    const column = (id: string) => {
      const record = detail.columns.find((entry) => entry.column.id === id);
      if (!record)
        throw new MacroNotFoundError(
          'A required field was deleted; reload the pipeline',
        );
      return PipelineColumn.from(this.client, table, record);
    };
    return rules.map((rule) => {
      const record = detail.columns.find(
        (entry) => entry.column.id === rule.stageColumnId,
      );
      const option = record?.definition.property_options.find(
        (entry) => entry.id === rule.stageId,
      );
      if (!record || !option)
        throw new MacroNotFoundError(
          'A required stage was deleted; reload the pipeline',
        );
      return {
        stageColumn: column(rule.stageColumnId),
        stage: PropertyOption.from(
          this.client,
          record.definition.definition.id,
          option,
        ),
        requiredFields: rule.requiredColumnIds.map(column),
      };
    });
  }

  /**
   * Require fields when entering a stage; an empty list removes that stage's rule.
   *
   * @write
   * @idempotent
   * @mcp-exclude Takes a handle built from a listing record, which an MCP call can't reference.
   */
  async setStageRequirements(
    stageColumn: PipelineColumn,
    stage: PropertyOption,
    requiredFields: PipelineColumn[],
  ): Promise<void> {
    if (
      [stageColumn, ...requiredFields].some(
        (column) => column.table.pipeline.id !== this.id,
      )
    )
      throw new Error('Fields belong to another pipeline');
    this.tableDetail.clear();
    const column = (await this.tableRecord()).columns.find(
      (entry) => entry.column.id === stageColumn.id,
    );
    if (!column || column.definition.definition.id !== stage.definitionId)
      throw new Error('The stage option belongs to another field');
    await this.mutate((client) =>
      client.storage.setCrmPipelineStageRequirement({
        path: { id: this.id },
        body: {
          stageColumnId: stageColumn.id,
          stageId: stage.id,
          requiredColumnIds: requiredFields.map((field) => field.id),
        },
      }),
    );
  }

  /**
   * Read the backing table through the pipeline's authorization boundary.
   *
   * @readonly
   */
  async table(): Promise<PipelineTable> {
    return PipelineTable.from(this.client, this, await this.tableRecord());
  }

  /**
   * Saved card order through this pipeline's authorization boundary.
   *
   * @readonly
   * @mcp-exclude Takes a handle built from a listing record, which an MCP call can't reference.
   */
  async viewPositions(view: PipelineView): Promise<CardPosition[]> {
    if (view.table.pipeline.id !== this.id)
      throw new Error('View belongs to another pipeline');
    return unwrap(
      await this.client.storage.getCrmPipelineViewPositions({
        path: { id: this.id, view: view.id },
      }),
    );
  }

  /**
   * @internal Cached table snapshot shared by all pipeline table handles.
   *
   * @readonly
   * @mcp-exclude Internal cache accessor shared by pipeline handles.
   */
  tableRecord(): Promise<TableDetail> {
    return this.tableDetail.get();
  }

  /**
   * Rows in pipeline order, automatically paginated.
   *
   * @readonly
   */
  rows(): AsyncGenerator<PipelineRow> {
    return paginate(async (after) => {
      const page = unwrap(
        await this.client.storage.getCrmPipelineRows({
          path: { id: this.id },
          query: { after },
        }),
      );
      return {
        items: page.rows.map((r) => PipelineRow.from(this.client, this, r)),
        nextCursor: page.next,
      };
    });
  }

  /**
   * Query pipeline rows, optionally restricting the query to typed row handles.
   *
   * @readonly
   */
  queryRows(
    options: { query?: StorageRowsQuery['query']; rows?: PipelineRow[] } = {},
  ): AsyncGenerator<PipelineRow> {
    if (options.rows?.some((r) => r.pipeline.id !== this.id))
      throw new Error('Rows belong to another pipeline');
    return paginate(async (after) => {
      const page = unwrap(
        await this.client.storage.queryCrmPipelineRows({
          path: { id: this.id },
          body: {
            after,
            query: options.query,
            rowIds: options.rows?.map((r) => r.id),
          },
        }),
      );
      return {
        items: page.rows.map((r) => PipelineRow.from(this.client, this, r)),
        nextCursor: page.next,
      };
    });
  }

  /**
   * Add companies or contacts as entries (deals), filling fields by name: a
   * stage by its label, a person as `'me'` or an email. A generic pipeline's
   * entries name no record, only fields. A record already in the pipeline is
   * not added again unless `allowDuplicates` (a separate second deal); its
   * entry comes back in `alreadyPresent`.
   *
   * @write
   */
  async addRecords(
    entries: { record?: PipelineRecordInput; set?: PipelineFieldInputs }[],
    options: { allowDuplicates?: boolean } = {},
  ): Promise<{
    added: PipelineEntry[];
    alreadyPresent: PipelineEntry[];
    version: number | undefined;
  }> {
    const body = {
      entries: entries.map(({ record, set }) => ({
        ...(record && recordTarget(record)),
        set: fieldInputs(set ?? {}),
      })),
      allowDuplicates: options.allowDuplicates ?? false,
    };
    const result = unwrap(
      await this.client.storage.addCrmPipelineEntries({
        path: { id: this.id },
        body,
      }),
    );
    this.tableDetail.clear();
    const recordType = await this.trackedRecordType();
    const entry = (record: (typeof result.added)[number]) =>
      PipelineEntry.from(this.client, this, recordType, record);
    return {
      added: result.added.map(entry),
      alreadyPresent: result.alreadyPresent.map(entry),
      version: result.version ?? undefined,
    };
  }

  /**
   * Set fields of entries by name, all or nothing: a stage by its label, a
   * person as `'me'` or an email, `null` to empty. Name an entry, or a company
   * or contact with exactly one entry here. Pass `baseVersion` (from
   * {@link CrmPipeline.find}) to refuse the change if the pipeline changed
   * since. Each returned entry carries the fields the update set.
   *
   * @destructive
   * @mcp-exclude Takes a pipeline entry built from a listing record, which an MCP call cannot reference.
   */
  async updateEntries(
    updates: {
      entry: PipelineEntry | Company | Contact;
      set: PipelineFieldInputs;
    }[],
    options: { baseVersion?: number } = {},
  ): Promise<{
    updated: { entry: PipelineEntry; changes: PipelineFieldChange[] }[];
    version: number | undefined;
  }> {
    const body = {
      updates: updates.map(({ entry, set }) => ({
        ...entryTarget(this, entry),
        set: fieldInputs(set),
      })),
      baseVersion: options.baseVersion,
    };
    const result = unwrap(
      await this.client.storage.updateCrmPipelineEntries({
        path: { id: this.id },
        body,
      }),
    );
    this.tableDetail.clear();
    const recordType = await this.trackedRecordType();
    return {
      updated: result.updated.map((updated) => {
        const fields = Object.fromEntries(
          updated.changes.flatMap((change) =>
            change.after ? [[change.field, change.after]] : [],
          ),
        );
        return {
          entry: PipelineEntry.from(this.client, this, recordType, {
            ...updated,
            fields,
          }),
          changes: updated.changes.map(fieldChange),
        };
      }),
      version: result.version ?? undefined,
    };
  }

  /**
   * Delete entries: each entry given, and every entry of each company or
   * contact given. The companies and contacts stay in the CRM. Returns the
   * deleted entries as they were.
   *
   * @destructive
   * @mcp-exclude Takes a pipeline entry built from a listing record, which an MCP call cannot reference.
   */
  async removeRecords(
    targets: (PipelineEntry | Company | Contact)[],
  ): Promise<{ removed: PipelineEntry[]; version: number | undefined }> {
    const entryIds: string[] = [];
    const recordIds: string[] = [];
    for (const target of targets) {
      if (target instanceof PipelineEntry) {
        if (target.pipeline.id !== this.id)
          throw new Error('Entry belongs to another pipeline');
        entryIds.push(target.id);
      } else recordIds.push(target.id);
    }
    const result = unwrap(
      await this.client.storage.removeCrmPipelineEntries({
        path: { id: this.id },
        body: { entryIds, recordIds },
      }),
    );
    this.tableDetail.clear();
    const recordType = await this.trackedRecordType();
    return {
      removed: result.removed.map((entry) =>
        PipelineEntry.from(this.client, this, recordType, entry),
      ),
      version: result.version ?? undefined,
    };
  }

  /**
   * Read entries by field name and label: `where` filters (`{ Stage: 'Demo' }`,
   * a list for any of several, `null` for empty), only some companies or
   * contacts, or a search of their names, domains and emails; sorted by a
   * field. Also answers per-stage counts and number totals (such as Revenue)
   * over every match, and the pipeline's fields and version.
   *
   * @param query.limit Most entries to return, 1 to 5000 (default 50); counts and totals cover every match.
   *
   * @readonly
   */
  async find(
    query: {
      where?: PipelineFieldInputs;
      records?: (Company | Contact)[];
      search?: string;
      sortBy?: string;
      descending?: boolean;
      limit?: number;
    } = {},
  ): Promise<{
    entries: PipelineEntry[];
    matched: number;
    complete: boolean;
    counts: PipelineOptionCounts[];
    totals: PipelineFieldTotal[];
    fields: PipelineField[];
    version: number;
  }> {
    const found = unwrap(
      await this.client.storage.findCrmPipelineEntries({
        path: { id: this.id },
        body: {
          filters: fieldInputs(query.where ?? {}),
          recordIds: query.records?.map((record) => record.id),
          search: query.search,
          sortBy: query.sortBy,
          descending: query.descending,
          limit: query.limit,
        },
      }),
    );
    const { fields, version, recordType } = found.pipeline;
    return {
      entries: found.entries.map((entry) =>
        PipelineEntry.from(this.client, this, recordType, entry),
      ),
      matched: found.matched,
      complete: found.complete,
      counts: found.counts,
      totals: found.totals,
      fields,
      version,
    };
  }

  /**
   * Rename or share the pipeline and change its fields and options by name,
   * in one change: add fields (text, number, checkbox, date, link, select,
   * multi_select, person or people), rename or delete fields, and add,
   * relabel or delete options (new Stage options become the last stages).
   * Returns the fields and version afterwards.
   *
   * @destructive
   */
  async edit(
    changes: EditPipelineRequest,
  ): Promise<{ fields: PipelineField[]; version: number }> {
    const edited = await this.mutate((client) =>
      client.storage.editCrmPipeline({ path: { id: this.id }, body: changes }),
    );
    this.tableDetail.clear();
    return { fields: edited.fields, version: edited.version };
  }

  /**
   * Add a CSV's rows as entries: CSV text, or a CSV document. Columns match
   * fields by name; Company and Domain (or Contact and Email) name each row's
   * record, created when the team lacks it. Records already here are not
   * added again, and select options the CSV needs are added.
   *
   * @write
   */
  async importCsv(source: string | Document): Promise<PipelineImport> {
    const body =
      typeof source === 'string' ? { csv: source } : { documentId: source.id };
    const outcome = unwrap(
      await this.client.storage.importCrmPipelineCsv({
        path: { id: this.id },
        body,
      }),
    );
    this.tableDetail.clear();
    return pipelineImport(this, outcome);
  }

  /**
   * Every entry as CSV text: Company and Domain (or Contact and Email), then
   * one column per field, people as emails; {@link CrmPipeline.importCsv}
   * reads the same layout. `complete` is false past 5000 entries.
   *
   * @readonly
   */
  async exportCsv(): Promise<{
    csv: string;
    name: string;
    rows: number;
    complete: boolean;
  }> {
    return unwrap(
      await this.client.storage.getCrmPipelineCsv({ path: { id: this.id } }),
    );
  }

  /** Save every entry as a CSV file in the caller's Macro files, laid out as {@link CrmPipeline.exportCsv} returns it.
   *
   * @write
   */
  async exportCsvFile(): Promise<{
    document: Document;
    rows: number;
    complete: boolean;
  }> {
    const exported = unwrap(
      await this.client.storage.exportCrmPipelineCsv({ path: { id: this.id } }),
    );
    return {
      document: Document.byId(this.client, exported.documentId),
      rows: exported.rows,
      complete: exported.complete,
    };
  }

  /** @internal Whether entries track companies or contacts; `undefined` for a generic pipeline. */
  private async trackedRecordType(): Promise<
    'company' | 'contact' | undefined
  > {
    return (await this.detail.get()).recordType ?? undefined;
  }

  /** Apply an atomic generated database operation batch through this pipeline.
   * As with Database.applyOps, batch-local UUIDs may name resources minted earlier in the batch.
   *
   * @destructive
   * @mcp-exclude Takes a handle built from a listing record, which an MCP call can't reference.
   */
  async applyOps(
    ops: DatabaseOp[],
    options?: { baseVersions?: { table: PipelineTable; version: number }[] },
  ) {
    if (options?.baseVersions?.some((v) => v.table.pipeline.id !== this.id))
      throw new Error('Table belongs to another pipeline');
    const body: OpBatch = {
      ops,
      baseVersions: options?.baseVersions
        ? Object.fromEntries(
            options.baseVersions.map((v) => [v.table.id, v.version]),
          )
        : undefined,
    };
    const result = await this.mutate((c) =>
      c.storage.applyCrmPipelineOps({ path: { id: this.id }, body }),
    );
    this.tableDetail.clear();
    return result;
  }
}

/** The wire form of a record to add. */
function recordTarget(
  record: PipelineRecordInput,
): { recordId: string } | { email: string } {
  if (record instanceof Company || record instanceof Contact)
    return { recordId: record.id };
  return { email: record.email };
}

/** The wire form of an entry to change. */
function entryTarget(
  pipeline: CrmPipeline,
  entry: PipelineEntry | Company | Contact,
): { entryId: string } | { recordId: string } {
  if (!(entry instanceof PipelineEntry)) return { recordId: entry.id };
  if (entry.pipeline.id !== pipeline.id)
    throw new Error('Entry belongs to another pipeline');
  return { entryId: entry.id };
}

/**
 * Backing table of a CRM pipeline.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class PipelineTable extends MacroEntity<TableDetail> {
  /** Serialize identity within its pipeline. */
  override toJSON() {
    return { ...super.toJSON(), pipelineId: this.pipeline.id };
  }

  private constructor(
    client: MacroClient,
    /** Parent pipeline. */
    readonly pipeline: CrmPipeline,
    record: TableDetail,
  ) {
    super(client, record.table.id, record);
  }

  /** Seed a table from a pipeline table response. */
  static from(
    client: MacroClient,
    pipeline: CrmPipeline,
    record: TableDetail,
  ): PipelineTable {
    return new PipelineTable(client, pipeline, record);
  }

  protected fetch(): Promise<TableDetail> {
    return this.pipeline.tableRecord();
  }

  /**
   * Columns in this table.
   *
   * @readonly
   */
  async columns(): Promise<PipelineColumn[]> {
    return (await this.pipeline.tableRecord()).columns.map((c) =>
      PipelineColumn.from(this.client, this, c),
    );
  }

  /**
   * Stored views in display order.
   *
   * @readonly
   */
  async views(): Promise<PipelineView[]> {
    return (await this.pipeline.tableRecord()).views.map((view) =>
      PipelineView.byId(this, view.id),
    );
  }

  /**
   * Table version for optimistic operation batches.
   *
   * @readonly
   */
  async version(): Promise<number> {
    return (await this.pipeline.tableRecord()).table.version;
  }

  /**
   * A scoped row handle.
   *
   * @readonly
   */
  rowById(id: string): PipelineRow {
    return PipelineRow.byId(this.client, this.pipeline, id);
  }

  /**
   * Rows from the authorized pipeline surface.
   *
   * @readonly
   */
  rows(): AsyncGenerator<PipelineRow> {
    return this.pipeline.rows();
  }
}

/**
 * A view owned and authorized by its CRM pipeline.
 *
 * @mcp-exclude Its table is built from a listing record; no id-only reference an MCP call can pass.
 */
export class PipelineView {
  private constructor(
    /** The pipeline table this view shows. */
    readonly table: PipelineTable,
    /** View identity within the pipeline. */
    readonly id: string,
  ) {}

  /** A handle to a stored view within a pipeline table. */
  static byId(table: PipelineTable, id: string): PipelineView {
    return new PipelineView(table, id);
  }

  /**
   * The current view definition from the pipeline's shared schema cache.
   *
   * @readonly
   */
  async detail(): Promise<DatabaseViewRecord> {
    const found = (await this.table.pipeline.tableRecord()).views.find(
      (view) => view.id === this.id,
    );
    if (!found)
      throw new MacroNotFoundError(
        `view ${this.id} is not on table ${this.table.id}`,
      );
    return found;
  }

  /**
   * Read only cards with saved positions; unplaced cards are omitted.
   * A saved lane may be stale after a row's grouping value changes outside a
   * card move. Compare each lane with the row's current grouping before using it.
   *
   * @readonly
   */
  positions(): Promise<CardPosition[]> {
    return this.table.pipeline.viewPositions(this);
  }

  /** Serialize identity without an authenticated client. */
  toJSON(): { id: string; tableId: string; pipelineId: string } {
    return {
      id: this.id,
      tableId: this.table.id,
      pipelineId: this.table.pipeline.id,
    };
  }
}

/** One pipeline row. */
export class PipelineRow extends MacroEntity<StorageRow> {
  /** Serialize identity within its pipeline. */
  override toJSON() {
    return { ...super.toJSON(), pipelineId: this.pipeline.id };
  }

  private constructor(
    client: MacroClient,
    /** Parent pipeline. */
    readonly pipeline: CrmPipeline,
    id: string,
    record?: StorageRow,
  ) {
    super(client, id, record);
  }

  /** Construct a scoped row handle. */
  static byId(
    client: MacroClient,
    pipeline: CrmPipeline,
    id: string,
  ): PipelineRow {
    return new PipelineRow(client, pipeline, id);
  }

  /** Seed a listed row. */
  static from(
    client: MacroClient,
    pipeline: CrmPipeline,
    record: StorageRow,
  ): PipelineRow {
    return new PipelineRow(client, pipeline, record.rowId, record);
  }

  protected async fetch(): Promise<StorageRow> {
    for await (const row of this.pipeline.queryRows({ rows: [this] }))
      if (row.id === this.id) return row.detail.get();
    throw new MacroNotFoundError(`Pipeline row ${this.id} is unavailable`);
  }

  /** Values keyed by property definition. */
  readonly cells = this.field('cells');

  /**
   * Reload this row after an operation batch.
   *
   * @readonly
   */
  async refresh(): Promise<void> {
    this.detail.clear();
    await this.detail.get();
  }
}

/**
 * A column belonging to a pipeline table.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class PipelineColumn extends MacroEntity<ColumnDetail> {
  /** Serialize identity within its pipeline. */
  override toJSON() {
    return {
      ...super.toJSON(),
      pipelineId: this.table.pipeline.id,
      tableId: this.table.id,
    };
  }

  private constructor(
    client: MacroClient,
    /** Parent table. */
    readonly table: PipelineTable,
    record: ColumnDetail,
  ) {
    super(client, record.column.id, record);
  }

  /** Seed a column handle. */
  static from(
    client: MacroClient,
    table: PipelineTable,
    record: ColumnDetail,
  ): PipelineColumn {
    return new PipelineColumn(client, table, record);
  }

  protected async fetch(): Promise<ColumnDetail> {
    const record = (await this.table.pipeline.tableRecord()).columns.find(
      (c) => c.column.id === this.id,
    );
    if (!record)
      throw new MacroNotFoundError(`Pipeline column ${this.id} is unavailable`);
    return record;
  }

  /**
   * Selectable options, including stable stage identities for requirement rules.
   *
   * @readonly
   */
  async options(): Promise<PropertyOption[]> {
    const column = await this.fetch();
    return column.definition.property_options.map((option) =>
      PropertyOption.from(this.client, column.definition.definition.id, option),
    );
  }

  /**
   * Whether the caller can write this column.
   *
   * @readonly
   */
  async writable(): Promise<boolean> {
    return (await this.fetch()).writable;
  }

  /**
   * Current column label.
   *
   * @readonly
   */
  async name(): Promise<string> {
    return (
      (await this.fetch()).column.display_name ??
      (await this.fetch()).definition.definition.display_name
    );
  }
}

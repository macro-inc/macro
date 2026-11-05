import type {
  AccessiblePipeline,
  CardPosition,
  ColumnDetail,
  CreatePipeline,
  DatabaseOp,
  DatabaseView as DatabaseViewRecord,
  OpBatch,
  StorageRow,
  StorageRowsQuery,
  TableDetail,
} from '../../../generated/storage/types.gen';
import { Lazy, MacroNotFoundError, paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { PropertyOption } from '../properties/property-option';
import {
  type SharePermissionOptions,
  sharePermissionBody,
} from '../sharing/permissions';
import { Team } from '../teams/team';
import { User } from '../users/user';

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

  /** Rename this pipeline. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.renameCrmPipeline({ path: { id: this.id }, body: { name } }),
    );
  }

  /** Change its sharing scope. */
  async setSharing(sharing: CreatePipeline['sharing']): Promise<void> {
    if (sharing === undefined) throw new Error('Sharing is required');
    await this.mutate((c) =>
      c.storage.shareCrmPipeline({ path: { id: this.id }, body: { sharing } }),
    );
  }

  /** Trash or restore the pipeline. */
  async setTrashed(trashed: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.trashCrmPipeline({ path: { id: this.id }, body: { trashed } }),
    );
  }

  /** Read sharing grants. */
  async sharePermissions() {
    return unwrap(
      await this.client.storage.getCrmPipelinePermissions({
        path: { id: this.id },
      }),
    );
  }

  /** Update sharing grants. */
  async updateSharePermissions(options: SharePermissionOptions) {
    return this.mutate((c) =>
      c.storage.updateCrmPipelinePermissions({
        path: { id: this.id },
        body: sharePermissionBody(options),
      }),
    );
  }

  /** Read stage rules with column and option handles that survive renames. */
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

  /** Require fields when entering a stage; an empty list removes that stage's rule. */
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

  /** Read the backing table through the pipeline's authorization boundary. */
  async table(): Promise<PipelineTable> {
    return PipelineTable.from(this.client, this, await this.tableRecord());
  }

  /** Saved card order through this pipeline's authorization boundary. */
  async viewPositions(view: PipelineView): Promise<CardPosition[]> {
    if (view.table.pipeline.id !== this.id)
      throw new Error('View belongs to another pipeline');
    return unwrap(
      await this.client.storage.getCrmPipelineViewPositions({
        path: { id: this.id, view: view.id },
      }),
    );
  }

  /** @internal Cached table snapshot shared by all pipeline table handles. */
  tableRecord(): Promise<TableDetail> {
    return this.tableDetail.get();
  }

  /** Rows in pipeline order, automatically paginated. */
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

  /** Query pipeline rows, optionally restricting the query to typed row handles. */
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

  /** Apply an atomic generated database operation batch through this pipeline.
   * As with Database.applyOps, batch-local UUIDs may name resources minted earlier in the batch. */
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

/** Backing table of a CRM pipeline. */
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

  /** Columns in this table. */
  async columns(): Promise<PipelineColumn[]> {
    return (await this.pipeline.tableRecord()).columns.map((c) =>
      PipelineColumn.from(this.client, this, c),
    );
  }

  /** Stored views in display order. */
  async views(): Promise<PipelineView[]> {
    return (await this.pipeline.tableRecord()).views.map((view) =>
      PipelineView.byId(this, view.id),
    );
  }

  /** Table version for optimistic operation batches. */
  async version(): Promise<number> {
    return (await this.pipeline.tableRecord()).table.version;
  }

  /** A scoped row handle. */
  rowById(id: string): PipelineRow {
    return PipelineRow.byId(this.client, this.pipeline, id);
  }

  /** Rows from the authorized pipeline surface. */
  rows(): AsyncGenerator<PipelineRow> {
    return this.pipeline.rows();
  }
}

/** A view owned and authorized by its CRM pipeline. */
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

  /** The current view definition from the pipeline's shared schema cache. */
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

  /** Reload this row after an operation batch. */
  async refresh(): Promise<void> {
    this.detail.clear();
    await this.detail.get();
  }
}

/** A column belonging to a pipeline table. */
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

  /** Selectable options, including stable stage identities for requirement rules. */
  async options(): Promise<PropertyOption[]> {
    const column = await this.fetch();
    return column.definition.property_options.map((option) =>
      PropertyOption.from(this.client, column.definition.definition.id, option),
    );
  }

  /** Whether the caller can write this column. */
  async writable(): Promise<boolean> {
    return (await this.fetch()).writable;
  }

  /** Current column label. */
  async name(): Promise<string> {
    return (
      (await this.fetch()).column.display_name ??
      (await this.fetch()).definition.definition.display_name
    );
  }
}

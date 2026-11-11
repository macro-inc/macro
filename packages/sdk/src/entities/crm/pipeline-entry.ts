import type {
  CompanyImportResponse,
  EntryFieldChange,
  EntryFieldValue,
  FieldOptionCounts,
  FieldTotal,
  FieldValueInput,
  PipelineEntry as PipelineEntryRecord,
  PipelineFieldSummary,
  PipelineImportResponse,
  SkippedImportRecord,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { Company } from './company';
import { Contact } from './contact';
import type { CrmPipeline } from './pipeline';

/**
 * A value to write into a pipeline field, or to match one against: an option
 * label such as a stage (`'Negotiation'`), a person as `'me'`, an email or a
 * `macro|` user id, a number, true/false, a date (`'2026-10-12'`), a list for
 * a field holding several values (in a filter, any of them matches), or
 * `null` to empty the field (in a filter, to match an empty field).
 */
export type PipelineFieldInput = string | number | boolean | string[] | null;

/** Pipeline fields by name (case-insensitive), each with what to write or match. */
export type PipelineFieldInputs = Record<string, PipelineFieldInput>;

/** A stored pipeline field value, tagged with its kind: `labels` for a stage or other select, `references` for people (`macro|` user ids). */
export type PipelineFieldValue = EntryFieldValue;

/** A field of a pipeline as entries and filters name it. */
export type PipelineField = PipelineFieldSummary;

/** A field's value before and after an update; `undefined` when empty. */
export type PipelineFieldChange = {
  field: string;
  before: PipelineFieldValue | undefined;
  after: PipelineFieldValue | undefined;
};

/** The company or contact an entry tracks, or a contact's email to add (in a company pipeline, its company). */
export type PipelineRecordInput = Company | Contact | { email: string };

/** Matched entries per option of a single-select field such as Stage, and how many have it empty. */
export type PipelineOptionCounts = FieldOptionCounts;

/** The sum of a number field such as Revenue over the matched entries. */
export type PipelineFieldTotal = FieldTotal;

/** A CSV row an import could not add: the company's domain or the contact's email, and why. */
export type PipelineImportSkip = SkippedImportRecord;

/** What a CSV import into a pipeline did. */
export type PipelineImport = Omit<
  PipelineImportResponse,
  'pipelineId' | 'pipelineName'
> & {
  /** The pipeline filled. */
  pipeline: CrmPipeline;
};

/** What a companies CSV import did. */
export type CompanyImport = Omit<CompanyImportResponse, 'pipeline'> & {
  /** The entries made from the CSV's Stage, Owner and Revenue, when it had any. */
  pipeline: PipelineImport | undefined;
};

/** @internal The wire form of named field values. */
export function fieldInputs(set: PipelineFieldInputs): FieldValueInput[] {
  return Object.entries(set).map(([field, input]) => {
    if (input === null) return { field };
    if (Array.isArray(input)) return { field, values: input };
    return { field, value: String(input) };
  });
}

/** @internal A pipeline import with its pipeline as a handle. */
export function pipelineImport(
  pipeline: CrmPipeline,
  outcome: PipelineImportResponse,
): PipelineImport {
  const { pipelineId: _id, pipelineName: _name, ...counts } = outcome;
  return { ...counts, pipeline };
}

/**
 * One entry of a CRM pipeline (a deal): the company or contact it tracks
 * (none in a generic pipeline of free-form rows) and its fields by name. Change it with {@link PipelineEntry.update} or take it
 * out with {@link PipelineEntry.remove}.
 *
 * @mcp-exclude Built from a pipeline listing; use CrmPipeline.updateEntries and removeRecords.
 */
export class PipelineEntry {
  private constructor(
    /** The pipeline holding it. */
    readonly pipeline: CrmPipeline,
    /** Entry identity within the pipeline. */
    readonly id: string,
    /** The company or contact it tracks; `undefined` in a generic pipeline. */
    readonly record: Company | Contact | undefined,
    /** The record's name; `undefined` when the caller cannot see it or there is none. */
    readonly recordName: string | undefined,
    /** A company's domain or a contact's email. */
    readonly recordDetail: string | undefined,
    /** Its fields that hold a value, by name, as the response that returned it carried them. */
    readonly fields: Record<string, PipelineFieldValue>,
  ) {}

  /** @internal Seed from a workflow response of a pipeline tracking `recordType`, or nothing. */
  static from(
    client: MacroClient,
    pipeline: CrmPipeline,
    recordType: 'company' | 'contact' | null | undefined,
    entry: Pick<PipelineEntryRecord, 'entryId' | 'record'> & {
      fields?: PipelineEntryRecord['fields'];
    },
  ): PipelineEntry {
    return new PipelineEntry(
      pipeline,
      entry.entryId,
      trackedRecord(client, recordType, entry.record?.id),
      entry.record?.name ?? undefined,
      entry.record?.detail ?? undefined,
      entry.fields ?? {},
    );
  }

  /**
   * Set fields by name: a stage by its label, a person as `'me'` or an email,
   * `null` to empty. Pass `baseVersion` (from {@link CrmPipeline.find}) to
   * refuse the change if the pipeline changed since.
   */
  async update(
    set: PipelineFieldInputs,
    options: { baseVersion?: number } = {},
  ): Promise<{
    entry: PipelineEntry;
    changes: PipelineFieldChange[];
    version: number | undefined;
  }> {
    const { updated, version } = await this.pipeline.updateEntries(
      [{ entry: this, set }],
      options,
    );
    const [change] = updated;
    if (!change) throw new Error('The update returned no entry');
    return { ...change, version };
  }

  /** Delete this entry; its company or contact stays in the CRM. */
  async remove(): Promise<void> {
    await this.pipeline.removeRecords([this]);
  }

  /** Serialize identity and the values read, without an authenticated client. */
  toJSON() {
    return {
      id: this.id,
      pipelineId: this.pipeline.id,
      record: this.record && {
        id: this.record.id,
        name: this.recordName,
        detail: this.recordDetail,
      },
      fields: this.fields,
    };
  }
}

/** The handle of an entry's tracked record, if the pipeline tracks one. */
function trackedRecord(
  client: MacroClient,
  recordType: 'company' | 'contact' | null | undefined,
  id: string | undefined,
): Company | Contact | undefined {
  if (id === undefined || !recordType) return undefined;
  return recordType === 'company'
    ? Company.byId(client, id)
    : Contact.byId(client, id);
}

/** @internal A field change with absent values as `undefined`. */
export function fieldChange(change: EntryFieldChange): PipelineFieldChange {
  return {
    field: change.field,
    before: change.before ?? undefined,
    after: change.after ?? undefined,
  };
}

export type PipelineRecordType = 'company' | 'contact';

/** Pipeline identity and sharing are independent of its customizable table. */
export type Pipeline = {
  id: string;
  teamId: string;
  name: string;
  userId: string;
  /** What each row tracks; null for a generic pipeline of free-form rows. */
  recordType: PipelineRecordType | null;
  databaseId: string;
  tableId: string;
  primaryColumnId: string;
  /** Stable host roles; absent while an older server is still serving metadata. */
  commercialFields?: {
    outcome?: string | null;
    money?: { amount: string; currency: string }[];
  };
  sharing: 'private' | 'team';
  grant: 'view' | 'comment' | 'edit' | 'owner';
  createdAt: string;
  trashedAt: string | null;
};

export type NewPipeline = Pick<Pipeline, 'name' | 'recordType' | 'sharing'>;

/** A pipeline whose rows each track a company or contact. */
export type TrackedPipeline = Pipeline & { recordType: PipelineRecordType };

export const isTrackedPipeline = (
  pipeline: Pipeline
): pipeline is TrackedPipeline => pipeline.recordType !== null;

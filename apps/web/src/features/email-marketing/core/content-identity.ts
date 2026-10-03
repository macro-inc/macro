import { v5 } from 'uuid';
export type SequenceContentOptions = {
  databaseId: string;
  campaignId: string;
  stepId: string;
  field: 'subject' | 'body';
  initialText: string;
};

/** A stable session for every field, including imported campaigns with non-UUID step IDs. */
export function sequenceContentId(options: SequenceContentOptions) {
  return v5(
    JSON.stringify([
      'macro.email-marketing.v1',
      options.databaseId,
      options.campaignId,
      options.stepId,
      options.field,
    ]),
    v5.URL
  );
}

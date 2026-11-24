import type { TimeSummaryFieldsFragment } from '@service-storage/graphql/generated/graphql';

/** One group of a summary, with its rows by the second grouping. */
export type TimeSummaryGroup = TimeSummaryFieldsFragment['groups'][number];
/** One total of a summary: a row under a group, or a total across groups. */
export type TimeSummaryTotal = TimeSummaryFieldsFragment['thenTotals'][number];
/** Who, what or when a total is for. */
export type TimeSummaryKey = TimeSummaryTotal['key'];

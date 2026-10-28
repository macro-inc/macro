import { propertyDateSortKey } from '@property/utils/sort';

/** Match the server's half-open ranges; absent or invalid dates use the missing bucket. */
export function propertyDateGroupKey(
  value: string | Date | null | undefined,
  bucketing: {
    ranges: readonly {
      key: string;
      start?: string | null;
      end?: string | null;
    }[];
    missingValueBucketKey: string;
  }
): string {
  const timestamp = propertyDateSortKey(value);
  if (timestamp === undefined) return bucketing.missingValueBucketKey;
  const date = timestamp;
  const range = bucketing.ranges.find(
    (range) =>
      (range.start == null ||
        date >= (propertyDateSortKey(range.start) ?? Infinity)) &&
      (range.end == null ||
        date < (propertyDateSortKey(range.end) ?? -Infinity))
  );
  return range?.key ?? bucketing.missingValueBucketKey;
}

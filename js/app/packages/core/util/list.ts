type Transform<T, U> = (item: T) => U | undefined;
type AsyncTransform<T, U> = (item: T) => Promise<U | undefined>;

/** Map a list from T to U, filtering out undefined (but not null) values. */
export function filterMap<T, U>(list: T[], transform: Transform<T, U>): U[] {
  return list.reduce<U[]>((acc, item) => {
    const result = transform(item);
    if (result !== undefined) {
      acc.push(result);
    }
    return acc;
  }, []);
}

/** Map a list from T to U, filtering out undefined (but not null) values. */
export async function filterMapAsync<T, U>(
  list: T[],
  transform: AsyncTransform<T, U>
): Promise<U[]> {
  const results: U[] = [];

  for (const item of list) {
    const result = await transform(item);
    if (result !== undefined) {
      results.push(result);
    }
  }

  return results;
}

export function intersection<T>(
  a: T[],
  b: T[],
  equal: (a: T, b: T) => boolean
): T[] {
  return a.filter((item) => b.some((other) => equal(item, other)));
}

/**
 * Merge two pre-sorted arrays into a single sorted array.
 * `compare` follows the Array.sort convention (negative if a goes first).
 */
export function mergeSortedArrays<T>(
  arr1: T[],
  arr2: T[],
  compare: (a: T, b: T) => number
): T[] {
  const merged: T[] = [];
  let i = 0;
  let j = 0;

  while (i < arr1.length && j < arr2.length) {
    if (compare(arr1[i], arr2[j]) <= 0) {
      merged.push(arr1[i]);
      i++;
    } else {
      merged.push(arr2[j]);
      j++;
    }
  }

  return [...merged, ...arr1.slice(i), ...arr2.slice(j)];
}

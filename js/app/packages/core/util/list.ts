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

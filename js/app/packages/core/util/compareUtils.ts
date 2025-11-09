export function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;

  for (const item of a.values()) {
    if (!b.has(item)) return false;
  }

  return true;
}

export function arrayEquals<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

export function mergeByKey<T extends Record<string, any>, K extends keyof T>(
  key: K,
  ...lists: T[][]
): T[] {
  const map = new Map<T[K], T>();

  for (const list of lists) {
    for (const item of list) {
      const id = item[key];
      if (!map.has(id)) {
        map.set(id, item);
      }
    }
  }

  return Array.from(map.values());
}

export function mapFromListsByKey<T extends Record<string, any>>(
  extractor: (item: T) => string,
  ...lists: T[][]
): Map<string, T> {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      const id = extractor(item);
      if (!map.has(id)) {
        map.set(id, item);
      }
    }
  }
  return map;
}

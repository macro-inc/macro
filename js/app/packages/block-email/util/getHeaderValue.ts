export function getHeaderValue(
  headers: unknown,
  key: string
): string | undefined {
  if (!headers) return undefined;
  const lower = key.toLowerCase();

  // Extract string from any value type
  const extract = (val: unknown): string | undefined => {
    if (typeof val === 'string') return val;
    if (Array.isArray(val) && val.length) return extract(val[0]);
    if (val && typeof val === 'object' && 'value' in val)
      return extract((val as any).value);
    return undefined;
  };

  // Array - check each item
  if (Array.isArray(headers)) {
    for (const h of headers) {
      const val = getHeaderValue(h, key);
      if (val) return val;
    }
    return undefined;
  }

  // String - parse as "key: value"
  if (typeof headers === 'string') {
    const idx = headers.indexOf(':');
    if (idx > -1 && headers.slice(0, idx).trim().toLowerCase() === lower) {
      return headers.slice(idx + 1).trim();
    }
    return undefined;
  }

  // Object/Map - iterate entries
  const entries = headers instanceof Map ? headers : Object.entries(headers);
  for (const [k, v] of entries) {
    if (typeof k === 'string' && k.toLowerCase() === lower) {
      return extract(v);
    }
  }

  // Special case: { name: '...', value: '...' }
  if (typeof headers === 'object' && 'name' in headers && 'value' in headers) {
    if (
      typeof (headers as any).name === 'string' &&
      (headers as any).name.toLowerCase() === lower
    ) {
      return extract((headers as any).value);
    }
  }

  return undefined;
}

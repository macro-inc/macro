const tokens = new WeakMap<object, bigint>();
let nextToken = 1n;

/** Function identity only; this token grants no construction or graph authority. */
export function constructorToken(klass: object): bigint {
  if (typeof klass !== 'function')
    throw new Error('Expected a node constructor');
  const existing = tokens.get(klass);
  if (existing !== undefined) return existing;
  if (nextToken > 0xffff_ffff_ffff_ffffn)
    throw new Error('Compatibility constructor identity exhausted');
  const token = nextToken++;
  tokens.set(klass, token);
  return token;
}

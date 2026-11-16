const INVALID_ROUTE_MODES = 'Invalid LEXICAL_ROUTE_MODES in service config';

/** Project only the validated public route policy from the synced bundle. */
export function lexicalRouteModesFromBundle(bundle: string): string {
  let values: unknown;
  try {
    values = JSON.parse(bundle);
  } catch {
    throw new Error(INVALID_ROUTE_MODES);
  }
  if (
    typeof values !== 'object' ||
    values === null ||
    !('LEXICAL_ROUTE_MODES' in values) ||
    typeof values.LEXICAL_ROUTE_MODES !== 'string'
  ) {
    throw new Error(INVALID_ROUTE_MODES);
  }
  const modes = values.LEXICAL_ROUTE_MODES;
  if (modes === '') return modes;
  const seen = new Set<string>();
  for (const assignment of modes.split(',')) {
    const match =
      /^(markdown|snapshot|composers|html)=(http|in_process|shadow)$/.exec(
        assignment
      );
    if (!match || match[0] !== assignment || seen.has(match[1])) {
      throw new Error(INVALID_ROUTE_MODES);
    }
    seen.add(match[1]);
  }
  return modes;
}

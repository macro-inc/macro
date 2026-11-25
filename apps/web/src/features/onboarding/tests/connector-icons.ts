import sources from './connector-icons.json' with { type: 'json' };

const icons = new Map(Object.entries(sources));

/** Local snapshots of actual catalog icons keep browser tests offline. */
export function fixtureConnectorIcon(slug: string): string | null {
  if (slug === 'github') return null;
  const icon = icons.get(slug);
  return icon ? `/connector-icons/${icon.file}` : null;
}

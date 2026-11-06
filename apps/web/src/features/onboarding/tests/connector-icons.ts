import { canonicalPipedreamSlug } from '@core/pipedream/slugs';
import sources from './connector-icons.json' with { type: 'json' };

const icons = new Map(Object.entries(sources));

/** Local snapshots of actual Pipedream icons keep browser tests offline. */
export function fixtureConnectorIcon(slug: string): string | null {
  if (slug === 'github') return null;
  const icon = icons.get(canonicalPipedreamSlug(slug));
  return icon ? `/connector-icons/${icon.file}` : null;
}

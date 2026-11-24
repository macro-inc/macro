import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  catalogFlags,
  type ImportSourceMatch,
  importSourceFor,
} from '../core/catalog';
import type { ImportProvider } from '../core/providers';

/**
 * Whether each import provider is rolled out to the user, read reactively
 * (FE-52). A flag that is still loading reads as off, so a gated provider
 * never shows and then disappears; a flag outside the catalog reads as off.
 */
export function createProviderFlags(): (provider: ImportProvider) => boolean {
  const flags = new Map(
    catalogFlags().map((flag) => [flag.key, useFeatureFlag(flag)])
  );
  return (provider) => {
    if (!provider.flag) return true;
    const flag = flags.get(provider.flag.key)?.();
    return flag !== undefined && !flag.loading && flag.enabled;
  };
}

/** `importSourceFor`, leaving out providers whose flag is off or loading. */
export function createImportSources(): (
  appSlug: string
) => ImportSourceMatch | undefined {
  const shown = createProviderFlags();
  return (appSlug) => {
    const found = importSourceFor(appSlug);
    return found && shown(found.provider) ? found : undefined;
  };
}

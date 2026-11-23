import {
  buildModelCatalog,
  type CatalogModelOption,
  matchesModelQuery,
} from '@core/component/AI/component/input/modelCatalog';
import {
  type ModelSpeed,
  nativeSpeeds,
} from '@core/component/AI/constant/speed';
import type { RosterAgent } from './roster';

export function modelSelection(
  options: CatalogModelOption[],
  agents: RosterAgent[],
  query: string,
  includeSuggested = false
) {
  const search = query.trim().toLocaleLowerCase();
  const catalog = buildModelCatalog(options, true);
  const suggested = catalog.frontier;
  const suggestedIds = new Set(suggested.map((option) => option.id));
  const allProviders = catalog.providers
    .map((provider) => ({
      ...provider,
      options: provider.options.filter(
        (option) =>
          (includeSuggested || !suggestedIds.has(option.id)) &&
          matchesModelQuery(option, search)
      ),
    }))
    .filter((provider) => provider.options.length > 0);
  return {
    suggested: (search ? options : suggested).filter((option) =>
      matchesModelQuery(option, search)
    ),
    allProviders,
    allModels: allProviders.flatMap((provider) => provider.options),
    agents: agents.filter((agent) =>
      agent.name.toLocaleLowerCase().includes(search)
    ),
  };
}

const SPEED_TIER_ORDER = { standard: 0, fast: 1, ultrafast: 2 };
/** Display tiers are distinct from the wire values, especially priority (OpenAI Fast). */
export function speedChoices(values: readonly string[]) {
  const offered = nativeSpeeds(values);
  if (!offered) return [];
  const tiers: {
    value: ModelSpeed;
    tier: 'standard' | 'fast' | 'ultrafast';
  }[] = [];
  for (const value of offered) {
    const tier =
      value === 'standard'
        ? 'standard'
        : value === 'ultrafast'
          ? 'ultrafast'
          : 'fast';
    if (tiers.some((choice) => choice.tier === tier)) continue;
    tiers.push({ value, tier });
  }
  return tiers.sort(
    (a, b) => SPEED_TIER_ORDER[a.tier] - SPEED_TIER_ORDER[b.tier]
  );
}

export function speedTier(value: string | undefined) {
  return value === 'ultrafast'
    ? 'ultrafast'
    : value === 'priority' || value === 'fast'
      ? 'fast'
      : 'standard';
}

/** Only the currently advertised options enable configuration rows. */
export function selectorOptions(state: {
  modelCount: number;
  customAgent: boolean;
  effortCount: number;
  speedValues: readonly string[];
}) {
  return {
    model: state.customAgent && state.modelCount > 1,
    effort: state.effortCount > 1,
    speed: speedChoices(state.speedValues).length > 1,
  };
}

export function hasSelectorOptions(
  options: ReturnType<typeof selectorOptions>
) {
  return options.model || options.effort || options.speed;
}

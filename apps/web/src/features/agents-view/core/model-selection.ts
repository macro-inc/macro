import {
  buildModelCatalog,
  type CatalogModelOption,
  type ModelProviderGroup,
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
  query: string
) {
  const search = query.trim().toLocaleLowerCase();
  const catalog = buildModelCatalog(options);
  return {
    suggested: catalog.frontier.filter((option) =>
      matchesModelQuery(option, search)
    ),
    providers: catalog.providers
      .map((provider) => ({
        ...provider,
        options: provider.options.filter((option) =>
          matchesModelQuery(option, search)
        ),
      }))
      .filter((provider) => provider.options.length > 0),
    agents: agents.filter((agent) =>
      agent.name.toLocaleLowerCase().includes(search)
    ),
  };
}

/** Search exposes every match without changing the remembered fold state. */
export function visibleProviderModels(
  provider: ModelProviderGroup,
  expanded: boolean,
  query: string
) {
  if (query.trim() || expanded || provider.options.length <= 3)
    return provider.options;
  return provider.options.slice(0, 2);
}

/** Only a current model hidden beyond a fold opens that provider initially. */
export function initiallyExpandedProviders(
  options: CatalogModelOption[],
  model: string | undefined
) {
  if (!model) return [];
  return buildModelCatalog(options)
    .providers.filter(
      (provider) =>
        provider.options.length > 3 &&
        provider.options.findIndex((option) => option.id === model) >= 2
    )
    .map((provider) => provider.label);
}

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
  return tiers;
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

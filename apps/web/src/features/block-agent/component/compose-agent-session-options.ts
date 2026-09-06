import { buildModelCatalog } from '@core/component/AI/component/input/modelCatalog';

/** A persona the composer can start a managed session as. */
export type PersonaOption = {
  id: string;
  /** Persisted bot id; absent for the deployment's built-in default persona. */
  botId?: string;
  name: string;
  handle: string;
  avatarUrl?: string;
  harness: string;
  defaultModel?: string;
  /** Why this persona cannot be picked right now, when it cannot. */
  unavailableReason?: string;
};

/** A model the user can pin the session to instead of the persona default. */
export type ModelOption = {
  id: string;
  name: string;
  /** The heading the harness lists this model under, when it groups them. */
  group?: string;
};

/**
 * How many override rows the menu shows up front. Enough to compare the
 * flagship choices at a glance; the rest sits behind "More models".
 */
export const MAX_FEATURED_MODELS = 5;

/**
 * How many personas show before the list collapses behind "+N more". The two
 * built-in coders always fit, leaving room for a couple of the user's own.
 */
export const MAX_VISIBLE_PERSONAS = 4;

/**
 * Harness slugs whose runtimes this deployment provisions itself — the only
 * personas the create composer can start. Anything else (a registered macrod
 * daemon, say) opens its own sessions and is refused by the create route.
 */
export function isManagedHarness(harness: string): boolean {
  return (
    harness === 'in-memory' || harness === 'macro-inmem' || harness === 'cursor'
  );
}

/**
 * User-facing name for the runtime a persona runs on. Harness ids are
 * plumbing ("in-memory", "sandbox"); the product names are the coders.
 */
export function harnessDisplayName(harness: string): string {
  switch (harness) {
    case 'in-memory':
    case 'macro-inmem':
    case 'sandbox':
      return 'Macro';
    case 'cursor':
      return 'Cursor';
    default:
      return harness;
  }
}

/** The persona rows to render, and how many the collapsed list hides. */
export type PersonaList = {
  visible: PersonaOption[];
  hiddenCount: number;
};

/**
 * The personas shown up front. Collapsed, the list keeps the first `max` in
 * order, but never hides the selected one: if it sits past the cut it takes
 * the last visible slot so the choice the user made stays on screen.
 */
export function visiblePersonas(
  personas: readonly PersonaOption[],
  selectedId: string | undefined,
  expanded: boolean,
  max = MAX_VISIBLE_PERSONAS
): PersonaList {
  if (expanded || personas.length <= max) {
    return { visible: [...personas], hiddenCount: 0 };
  }
  const visible = personas.slice(0, max);
  const selected = personas.find((persona) => persona.id === selectedId);
  if (selected && !visible.some((persona) => persona.id === selected.id)) {
    visible[max - 1] = selected;
  }
  return { visible, hiddenCount: personas.length - max };
}

/**
 * The models offered as explicit overrides. The persona's own default is
 * already the "Agent default" choice, so listing it again would offer two
 * rows that do the same thing.
 */
export function overrideModelOptions(
  persona: PersonaOption | undefined,
  available: readonly ModelOption[]
): ModelOption[] {
  const defaultModel = persona?.defaultModel;
  return defaultModel
    ? available.filter((model) => model.id !== defaultModel)
    : [...available];
}

/** The override rows split into the featured shortlist and the overflow. */
export type ModelShortlist = {
  featured: ModelOption[];
  more: ModelOption[];
};

/**
 * Cap the override list so the user compares a handful of models rather
 * than scrolling a whole catalog. Short lists show in full. Long ones lead
 * with the catalog's recommended picks (the flagship of each family the
 * harness offers) and put everything else behind "More models".
 */
export function shortlistModelOptions(
  persona: PersonaOption | undefined,
  available: readonly ModelOption[],
  max = MAX_FEATURED_MODELS
): ModelShortlist {
  const overrides = overrideModelOptions(persona, available);
  if (overrides.length <= max) return { featured: overrides, more: [] };

  const catalog = buildModelCatalog(
    overrides.map((model) => ({
      id: model.id,
      label: model.name,
      group: model.group,
    }))
  );
  const featuredIds = new Set(
    catalog.recommended.slice(0, max).map((option) => option.id)
  );
  // Fill from the harness's own order if curation found fewer than `max`.
  for (const model of overrides) {
    if (featuredIds.size >= max) break;
    featuredIds.add(model.id);
  }
  return {
    featured: overrides.filter((model) => featuredIds.has(model.id)),
    more: overrides.filter((model) => !featuredIds.has(model.id)),
  };
}

/**
 * Label for the "leave the model alone" choice. Names the persona's default
 * when it is known so the user sees what they will get without overriding.
 */
export function personaDefaultLabel(
  persona: PersonaOption | undefined,
  available: readonly ModelOption[]
): string {
  const defaultModel = persona?.defaultModel;
  if (!defaultModel) return 'Agent default';
  const name =
    available.find((model) => model.id === defaultModel)?.name ?? defaultModel;
  return `Agent default · ${name}`;
}

/** Short label for the closed model pill. */
export function modelPillLabel(
  override: string,
  persona: PersonaOption | undefined,
  available: readonly ModelOption[]
): string {
  if (override) {
    return available.find((model) => model.id === override)?.name ?? override;
  }
  const defaultModel = persona?.defaultModel;
  if (!defaultModel) return 'Default model';
  return (
    available.find((model) => model.id === defaultModel)?.name ?? defaultModel
  );
}

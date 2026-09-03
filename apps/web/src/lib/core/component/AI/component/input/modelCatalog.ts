export type CatalogModelOption = {
  id: string;
  label: string;
  description?: string;
};

export type ModelFamily = {
  label: string;
  options: CatalogModelOption[];
};

export type ModelCatalog = {
  recommended: CatalogModelOption[];
  families: ModelFamily[];
};

const FAMILY_RULES: readonly {
  label: string;
  match: (label: string) => boolean;
}[] = [
  {
    label: 'Auto',
    match: (label) => label === 'Auto' || label.startsWith('Auto '),
  },
  { label: 'Cursor Grok', match: (label) => label.startsWith('Cursor Grok') },
  { label: 'Claude Opus', match: (label) => label.startsWith('Claude Opus') },
  {
    label: 'Claude Sonnet',
    match: (label) => label.startsWith('Claude Sonnet'),
  },
  { label: 'Claude Fable', match: (label) => label.startsWith('Claude Fable') },
  { label: 'Claude Haiku', match: (label) => label.startsWith('Claude Haiku') },
  { label: 'GPT', match: (label) => label.startsWith('GPT-') },
  { label: 'Gemini', match: (label) => label.startsWith('Gemini ') },
  { label: 'Codex', match: (label) => label.startsWith('Codex ') },
  { label: 'Kimi', match: (label) => label.startsWith('Kimi ') },
  { label: 'GLM', match: (label) => label.startsWith('GLM ') },
];

const RECOMMENDED_PREFIXES = [
  'Auto',
  'Cursor Grok 4.6',
  'Claude Opus 5',
  'Claude Sonnet 5',
  'GPT-5.6 Sol',
  'Gemini 3.8 Flash',
  'Codex',
  'Kimi K3',
] as const;

/** First-screen shortlist size; the rest goes behind More models. */
export const MAX_RECOMMENDED_MODELS = 5;

/** Large third-party catalogs need structure rather than one long flat list. */
export function isLargeModelCatalog(options: readonly CatalogModelOption[]) {
  return options.length > 10;
}

export function familyForModel(label: string) {
  return (
    FAMILY_RULES.find((rule) => rule.match(label))?.label ??
    label.split(' ').slice(0, 2).join(' ')
  );
}

export function buildModelCatalog(
  options: readonly CatalogModelOption[],
  selectedId?: string | null
): ModelCatalog {
  const recommended: CatalogModelOption[] = [];
  const recommendedIds = new Set<string>();
  const recommendedLabels = new Set<string>();

  const pushRecommended = (option: CatalogModelOption | undefined) => {
    if (
      !option ||
      recommended.length >= MAX_RECOMMENDED_MODELS ||
      recommendedIds.has(option.id) ||
      recommendedLabels.has(option.label)
    )
      return;
    recommended.push(option);
    recommendedIds.add(option.id);
    recommendedLabels.add(option.label);
  };

  pushRecommended(options.find((option) => option.id === selectedId));
  for (const prefix of RECOMMENDED_PREFIXES) {
    pushRecommended(
      options.find((option) =>
        prefix === 'Codex'
          ? option.label.startsWith(prefix)
          : option.label === prefix || option.label.startsWith(`${prefix} `)
      )
    );
  }

  const grouped = new Map<string, CatalogModelOption[]>();
  for (const option of options) {
    const family = familyForModel(option.label);
    const entries = grouped.get(family);
    if (entries) entries.push(option);
    else grouped.set(family, [option]);
  }

  const familyOrder = FAMILY_RULES.map((rule) => rule.label);
  const families = Array.from(grouped.entries())
    .sort(([left], [right]) => {
      const leftIndex = familyOrder.indexOf(left);
      const rightIndex = familyOrder.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1)
        return left.localeCompare(right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([label, familyOptions]) => ({ label, options: familyOptions }));

  return { recommended, families };
}

/** Family buckets with the first-screen recommended shortlist removed. */
export function moreModelFamilies(catalog: ModelCatalog): ModelFamily[] {
  const recommendedIds = new Set(
    catalog.recommended.map((option) => option.id)
  );
  const recommendedLabels = new Set(
    catalog.recommended.map((option) => option.label)
  );
  return catalog.families
    .map((family) => ({
      label: family.label,
      options: family.options.filter(
        (option) =>
          !recommendedIds.has(option.id) && !recommendedLabels.has(option.label)
      ),
    }))
    .filter((family) => family.options.length > 0);
}

export type CatalogModelOption = {
  id: string;
  label: string;
  description?: string;
  /**
   * The heading the harness listed this model under (an ACP select group
   * name). Absent when the harness offered a flat list, in which case the
   * catalog has one unlabelled family.
   */
  group?: string;
};

export type ModelFamily = {
  /** `null` for models the harness did not put under any heading. */
  label: string | null;
  options: CatalogModelOption[];
};

export type ModelCatalog = {
  recommended: CatalogModelOption[];
  families: ModelFamily[];
};

/**
 * The flagship models to feature on the first screen, matched against the
 * label the harness gave them. Product curation, not grouping: which model
 * belongs to which family is the harness's call and arrives on `group`.
 */
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

/** Bucket options under the harness's headings, in the order it listed them. */
function familiesOf(options: readonly CatalogModelOption[]): ModelFamily[] {
  const families: ModelFamily[] = [];
  for (const option of options) {
    const label = option.group ?? null;
    const family = families.find((candidate) => candidate.label === label);
    if (family) family.options.push(option);
    else families.push({ label, options: [option] });
  }
  return families;
}

export function buildModelCatalog(
  options: readonly CatalogModelOption[],
  selectedId?: string | null
): ModelCatalog {
  const families = familiesOf(options);
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
  // A harness whose names the curated list does not know still gets a useful
  // shortlist: the first model of each of its headings, in its own order.
  for (const family of families) {
    pushRecommended(family.options[0]);
  }

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

/** Whether a search query hits this model by name or by its heading. */
export function matchesModelQuery(option: CatalogModelOption, query: string) {
  return (
    option.label.toLowerCase().includes(query) ||
    (option.group?.toLowerCase().includes(query) ?? false)
  );
}

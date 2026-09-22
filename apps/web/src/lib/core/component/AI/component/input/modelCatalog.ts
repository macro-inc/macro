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

/**
 * A version-looking token: alphanumerics and dots with a digit first or
 * second (`4.6`, `5`, `K3`, `o3`, `R1`), but not `GPT`, `Sol`, or `Mini`.
 */
function isVersionToken(token: string): boolean {
  const [first, second] = token;
  const startsLikeAVersion =
    (first !== undefined && /\d/.test(first)) ||
    (first !== undefined &&
      second !== undefined &&
      /[A-Za-z]/.test(first) &&
      /\d/.test(second));
  return startsLikeAVersion && /^[A-Za-z0-9.]+$/.test(token);
}

/**
 * The family a display name belongs to: the words before its first
 * version-looking token, with `GPT-5.6` split at the hyphen so the version is
 * seen. A name with no version, or one that starts with a version (`Auto`,
 * `o3 Pro`), is its own family.
 *
 * This is the same rule the Cursor ACP agent applies before it sends ACP
 * groups (`CursorModel::family` in `crates/cursor_cloud_agents`). It runs
 * here only for harnesses that sent no groups, so those catalogs read the
 * same way rather than as one long flat list.
 */
export function inferModelFamily(label: string): string {
  const tokens = label
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((token) => {
      const hyphen = token.indexOf('-');
      const afterHyphen = token[hyphen + 1];
      return hyphen > 0 && afterHyphen !== undefined && /\d/.test(afterHyphen)
        ? [token.slice(0, hyphen), token.slice(hyphen + 1)]
        : [token];
    });
  const family: string[] = [];
  for (const token of tokens) {
    if (isVersionToken(token)) break;
    family.push(token);
  }
  if (family.length === 0 || family.length === tokens.length)
    return label.trim();
  return family.join(' ');
}

function bucketBy(
  options: readonly CatalogModelOption[],
  labelOf: (option: CatalogModelOption) => string | null
): ModelFamily[] {
  const families: ModelFamily[] = [];
  for (const option of options) {
    const label = labelOf(option);
    const family = families.find((candidate) => candidate.label === label);
    if (family) family.options.push(option);
    else families.push({ label, options: [option] });
  }
  return families;
}

/**
 * Bucket options under the harness's headings, in the order it listed them.
 * A harness that sent no headings gets them inferred from the names; if that
 * still finds no family with two members, the list stays one unlabelled
 * family rather than gaining a header per model.
 */
function familiesOf(options: readonly CatalogModelOption[]): ModelFamily[] {
  if (options.some((option) => option.group)) {
    return bucketBy(options, (option) => option.group ?? null);
  }
  const inferred = bucketBy(options, (option) =>
    inferModelFamily(option.label)
  );
  return inferred.some((family) => family.options.length > 1)
    ? inferred
    : [{ label: null, options: [...options] }];
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

/**
 * The heading to show beside a model: the harness's, or the inferred one when
 * the harness sent none. `undefined` when it would only repeat the label.
 */
export function modelFamilyHint(
  option: CatalogModelOption
): string | undefined {
  const family = option.group ?? inferModelFamily(option.label);
  return family === option.label ? undefined : family;
}

/** Whether a search query hits this model by name or by its heading. */
export function matchesModelQuery(option: CatalogModelOption, query: string) {
  const family = option.group ?? inferModelFamily(option.label);
  return (
    option.label.toLowerCase().includes(query) ||
    family.toLowerCase().includes(query)
  );
}

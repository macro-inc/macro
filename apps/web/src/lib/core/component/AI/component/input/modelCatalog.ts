import { modelProvider } from '../ProviderIcon';

export type CatalogModelOption = {
  id: string;
  label: string;
  description?: string;
  /**
   * The heading the harness listed this model under (an ACP select group
   * name), also available as a search term.
   */
  group?: string;
};

export type ModelProviderGroup = {
  label: string;
  options: CatalogModelOption[];
};

export type ModelCatalog = {
  frontier: CatalogModelOption[];
  providers: ModelProviderGroup[];
};

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
 * groups (`CursorModel::family` in `crates/cursor_cloud_agents`). It remains
 * searchable for harnesses that sent no groups.
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

const PROVIDER_PATTERNS: [RegExp, string][] = [
  [/^(anthropic|claude|opus|sonnet|haiku)\b/, 'Anthropic'],
  [/^(openai|gpt|chatgpt|codex|sol|astra)\b|^o[134](?:$|[ -])/, 'OpenAI'],
  [/^(google|gemini|gemma)\b/, 'Google'],
  [/^(cursor[ -])?grok\b|^xai\b/, 'xAI'],
  [/^deepseek\b/, 'DeepSeek'],
  [/^(kimi|moonshot)\b/, 'Moonshot AI'],
  [/^glm(?=\b|\d)|^(z\.ai|zai)\b/, 'Z.ai'],
  [/^qwen(?=\b|\d)|^alibaba\b/, 'Alibaba'],
  [/^minimax\b/, 'MiniMax'],
  [/^llama(?=\b|\d)|^meta\b/, 'Meta'],
  [/^(nemotron|nvidia)\b/, 'NVIDIA'],
  [/^(mistral|mixtral|codestral|devstral)\b/, 'Mistral'],
  [/^muse\b/, 'Muse'],
  [/^cursor\b/, 'Cursor'],
];

/** Model authors, independent of the gateway serving a routed model. */
export function modelProviderLabel(option: CatalogModelOption): string {
  const id = option.id.toLowerCase().replace(/^[\w.-]+\//, '');
  const name = option.label.toLowerCase();
  const group = option.group?.toLowerCase() ?? '';
  const matches = (pattern: RegExp) =>
    pattern.test(id) || pattern.test(name) || pattern.test(group);
  if (matches(/^(auto|automatic|default)(?:$|[ -])/)) return 'Automatic';
  const known =
    modelProvider(option.id) ??
    modelProvider(id) ??
    modelProvider(name.replace(/\s+/g, '-'));
  if (known) {
    return {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google',
      kimi: 'Moonshot AI',
      deepseek: 'DeepSeek',
      muse: 'Muse',
    }[known];
  }
  return (
    PROVIDER_PATTERNS.find(([pattern]) => matches(pattern))?.[1] ??
    'Other models'
  );
}

/**
 * Four stable flagship choices. Prefer the base model over effort/speed
 * variants; every other variant remains in its provider's section. Include
 * suggested choices in provider groups when building the complete catalog.
 */
export function buildModelCatalog(
  options: readonly CatalogModelOption[],
  includeSuggested = false
): ModelCatalog {
  const frontierPatterns = [
    /^(?:claude[ -])?opus[ -]5[.-]5(?:$|[ -])/i,
    /^(?:claude[ -])?sonnet[ -]5[.-]5(?:$|[ -])/i,
    /^(?:gpt[ -]\d+(?:\.\d+)?[ -])?sol(?:$|[ -])|^gpt[ -]5\.6(?:[ -]sol)?(?:$|[ -](?:high|medium|low|fast)\b)/i,
    /^(?:gpt[ -]\d+(?:\.\d+)?[ -])?astra(?:$|[ -])/i,
  ];
  const frontier: CatalogModelOption[] = [];
  for (const pattern of frontierPatterns) {
    const candidates = options.filter((option) => pattern.test(option.label));
    const base = candidates.find(
      (option) => !/\b(high|medium|low|fast|thinking|max)\b/i.test(option.label)
    );
    const choice = base ?? candidates[0];
    if (choice && !frontier.some((option) => option.id === choice.id))
      frontier.push(choice);
  }
  const frontierIds = new Set(frontier.map((option) => option.id));
  const providers: ModelProviderGroup[] = [];
  for (const option of options) {
    if (!includeSuggested && frontierIds.has(option.id)) continue;
    const label = modelProviderLabel(option);
    const provider = providers.find((candidate) => candidate.label === label);
    if (provider) provider.options.push(option);
    else providers.push({ label, options: [option] });
  }
  // Major providers first, then the rest alphabetically; automatic routing
  // stays discoverable immediately below the frontier section.
  const leading = ['Automatic', 'Anthropic', 'OpenAI', 'Google'];
  providers.sort((a, b) => {
    const rank = (label: string) => {
      const index = leading.indexOf(label);
      return index >= 0
        ? index
        : label === 'Other models'
          ? leading.length + 1
          : leading.length;
    };
    return rank(a.label) - rank(b.label) || a.label.localeCompare(b.label);
  });
  return { frontier, providers };
}

/**
 * Whether a search query hits this model by name, by its heading, or by its
 * id — a name displayed as "Sonnet 5.5" should still be findable by typing the
 * vendor out of its `anthropic/claude-sonnet-5-5` slug.
 */
export function matchesModelQuery(option: CatalogModelOption, query: string) {
  const family = option.group ?? inferModelFamily(option.label);
  return (
    option.label.toLowerCase().includes(query) ||
    family.toLowerCase().includes(query) ||
    option.id.toLowerCase().includes(query) ||
    modelProviderLabel(option).toLowerCase().includes(query)
  );
}

/**
 * Readable model names, shared by every surface that shows one: the chat and
 * agent composers, the session side panel, and the transcript.
 *
 * Model ids reach the UI from three places — the frontend's own routed ids,
 * a harness's ACP catalog, and a session row — and only the first is
 * guaranteed to be in {@link MODEL_PRETTYNAME}. Harnesses that keep no
 * display name for a model (the in-memory Macro Agent among them) echo the
 * slug back as the name, so anything that renders the reported name verbatim
 * shows `claude-sonnet-5` where the rest of the app says "Sonnet 5". Route
 * those through {@link modelLabel} instead.
 */

import { MODEL_PRETTYNAME, type Model } from './model';

/** Vendor acronyms that read as shouting only when they are not shouted. */
const ACRONYMS = new Set(['gpt', 'ai', 'llm']);

/** Trailing qualifiers the house names keep lowercase ("GPT-5.6 mini"). */
const QUALIFIERS = new Set(['mini', 'nano', 'lite']);

const isVersion = (token: string) => /^\d+(\.\d+)*$/.test(token);

function formatToken(token: string): string {
  const lower = token.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  if (QUALIFIERS.has(lower)) return lower;
  if (isVersion(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * A slug nobody has a name for, read as a name: `anthropic/claude-sonnet-3.8`
 * becomes "Sonnet 3.8" and `openai/gpt-5-mini` becomes "GPT-5 mini". The
 * vendor prefix goes because the provider logo beside the label already says
 * it, and split version parts (`haiku-4-5`) rejoin as one number.
 */
function humanizeModelId(id: string): string {
  const tokens = id
    .trim()
    .replace(/^[\w.-]+\//, '')
    .split(/[-_\s]+/)
    .filter(Boolean);
  if (tokens.length > 1 && tokens[0]?.toLowerCase() === 'claude')
    tokens.shift();
  // A pinned release date ("claude-3-7-sonnet-20250219") is plumbing.
  if (tokens.length > 1 && /^\d{6,}$/.test(tokens.at(-1) ?? '')) tokens.pop();
  if (tokens.length === 0) return id;

  return tokens.reduce((label, token, index) => {
    const previous = tokens[index - 1];
    if (previous === undefined) return formatToken(token);
    if (isVersion(token) && isVersion(previous)) return `${label}.${token}`;
    if (isVersion(token) && ACRONYMS.has(previous.toLowerCase()))
      return `${label}-${token}`;
    return `${label} ${formatToken(token)}`;
  }, '');
}

/**
 * What to call a model: the house name when the app knows the id, otherwise
 * the runtime's own display name, otherwise the id read as a name. `name` is
 * ignored when it is just the id again, which is how a runtime says it has
 * no name for the model.
 */
export function modelLabel(id: string | undefined, name?: string): string {
  if (!id) return 'Model';
  const pretty =
    MODEL_PRETTYNAME[id as Model] ??
    MODEL_PRETTYNAME[`anthropic/${id}` as Model];
  if (pretty) return pretty;
  const reported = name?.trim();
  if (reported && reported !== id.trim())
    return reported
      .replace(/^(anthropic|openai|google)\//, '')
      .replace(/^Claude /, '');
  return humanizeModelId(id);
}

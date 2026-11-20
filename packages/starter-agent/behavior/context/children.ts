type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What every child process gets from the agent's own environment: enough to
 * find programs, a home, a locale and a screen (its browser's DevTools
 * included), and nothing else. The rest of
 * its environment (where its credentials are, anything a launcher left) stays
 * with it; a child is given more only by name, by whoever starts it.
 */
export const baseline = [
  'PATH',
  'HOME',
  'LANG',
  'TZ',
  'DISPLAY',
  'PULSE_SERVER',
  'XDG_RUNTIME_DIR',
  'MUPPET_BROWSER_CDP_URL',
] as const;

/** A child's environment: the baseline of `own`, then `added`, where an undefined value unsets one. */
export const childEnvironment = (
  own: Environment,
  added: Environment = {}
): Record<string, string> =>
  Object.fromEntries(
    Object.entries({
      ...Object.fromEntries(baseline.map((name) => [name, own[name]])),
      ...added,
    }).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]]))
  );

const claudeProgram = 'claude';

/** The `claude` on PATH, which the image provides: the wrapper that signs in with harnessd's token when no Anthropic gateway is given. */
export const claude = (): string => {
  const found = Bun.which(claudeProgram);
  if (found === null) throw new Error(`${claudeProgram} is not on PATH`);
  return found;
};

/**
 * How Claude Code reaches Anthropic: through Macro's gateway when enrollment
 * gave these keys (Macro-credits mode), and otherwise with nothing here, since
 * the `claude` wrapper on PATH signs in with harnessd's token itself. Never
 * an OAuth token of the agent's own.
 */
export const claudeKeys = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
] as const;

/**
 * Where the Anthropic gateway is in Macro-credits mode, and its token, which
 * is the agent's Macro key: only the relay uses them. Undefined in harnessd
 * sign-in mode, where the `claude` wrapper signs in itself.
 */
export const anthropicUpstream = (
  credentials: Readonly<Record<string, string>>
): { readonly url: string; readonly token: string } | undefined => {
  const url = credentials.ANTHROPIC_BASE_URL;
  const token = credentials.ANTHROPIC_AUTH_TOKEN;
  if (url === undefined || url === '' || token === undefined || token === '')
    return undefined;
  return { url, token };
};

/** The relay's path to the Anthropic gateway. */
export const anthropicRoute = 'anthropic';

/**
 * How a Claude Code started by the agent (its own, or a call's brain) reaches
 * Anthropic in Macro-credits mode: through the relay, with the relay's
 * capability as its token, so no child holds the real one. Nothing in
 * sign-in mode.
 */
export const claudeAccess = (
  credentials: Readonly<Record<string, string>>,
  relay: { readonly url: string; readonly token: string }
): Record<string, string> => {
  if (anthropicUpstream(credentials) === undefined) return {};
  const quiet = credentials.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  return {
    ANTHROPIC_BASE_URL: `${relay.url}/${anthropicRoute}`,
    ANTHROPIC_AUTH_TOKEN: relay.token,
    ...(quiet === undefined || quiet === ''
      ? {}
      : { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: quiet }),
  };
};

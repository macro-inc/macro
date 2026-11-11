type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What every child process gets from the agent's own environment: enough to
 * find programs, a home, a locale and a screen, and nothing else. The rest of
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

export const claudeAccess = (
  credentials: Readonly<Record<string, string>>
): Record<string, string> =>
  Object.fromEntries(
    claudeKeys.flatMap((name) => {
      const value = credentials[name];
      return value === undefined || value === '' ? [] : [[name, value]];
    })
  );

/**
 * The iframe's `sandbox` gives the document an opaque origin, so it cannot reach
 * Macro's cookies, storage or DOM. This policy keeps it off the network: scripts
 * and styles must be inline, and images and fonts must be embedded.
 */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

export const ARTIFACT_SANDBOX = 'allow-scripts';

const THEME_TOKENS = [
  '--color-panel',
  '--color-ink',
  '--color-ink-muted',
  '--color-accent',
  '--color-edge-muted',
];

/** Macro's resolved theme colors, for artifacts that want to match the app. */
export function artifactThemeTokens(element: Element): Record<string, string> {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    THEME_TOKENS.map((token) => [token, style.getPropertyValue(token).trim()])
  );
}

/** Build the srcdoc. The parser never runs scripts, and the policy is parsed
 * first so that nothing in the artifact can run or load before it applies. */
export function composeArtifactDocument(
  html: string,
  tokens: Record<string, string>
): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  for (const refresh of parsed.querySelectorAll('meta[http-equiv="refresh" i]'))
    refresh.remove();

  const theme = parsed.createElement('style');
  theme.textContent = `:root{${Object.entries(tokens)
    .map(([token, value]) => `${token}:${value}`)
    .join(';')}}`;

  const policy = parsed.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = ARTIFACT_CSP;

  parsed.head.prepend(policy, theme);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

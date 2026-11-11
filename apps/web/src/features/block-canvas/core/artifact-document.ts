import type { ArtifactLibrary } from '@macro-inc/graphics/loro';

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

/**
 * Focus inside a frame keeps keys from the host, so the host cannot exit or step
 * through a presentation. Forward the few it needs, unless the artifact handled
 * them or the user is typing. The host trusts these only as navigation.
 */
const KEY_BRIDGE = `addEventListener('keydown', function (event) {
  var escape = event.key === 'Escape';
  if (!escape && event.defaultPrevented) return;
  if (!escape && ['ArrowLeft', 'ArrowRight', ' ', 'PageUp', 'PageDown'].indexOf(event.key) === -1) return;
  var target = event.target;
  if (!escape && target.closest && target.closest('input,textarea,select,button,a,[contenteditable]')) return;
  parent.postMessage({ macroArtifactKey: event.key }, '*');
});`;

/** Bound cycles and fan-out between components. Expansion runs on the host's main
 * thread, and a peer can store entries past the authoring limit. */
const MAX_COMPONENT_EXPANSIONS = 500;
const MAX_EXPANDED_LENGTH = 2_000_000;

const entry = (
  entries: Readonly<Record<string, string>>,
  name: string | null
) =>
  name !== null && Object.hasOwn(entries, name) ? entries[name] : undefined;

/**
 * `<macro-component name="card">` becomes that component, with its children in
 * place of the component's `<slot>`. `<macro-style name="brand">` becomes a style
 * element. An unknown component keeps its children, and an unknown style is dropped.
 */
function expandLibrary(parsed: Document, library: ArtifactLibrary) {
  // One work list rather than re-querying after each expansion, which is quadratic.
  const pending = Array.from(parsed.querySelectorAll('macro-component'));
  let expansions = 0;
  let expandedLength = 0;
  while (pending.length) {
    const use = pending.pop()!;
    // Gone with a component that had no slot for it.
    if (!use.isConnected) continue;

    const source = entry(library.components, use.getAttribute('name'));
    expansions += 1;
    expandedLength += source?.length ?? 0;
    if (
      expansions > MAX_COMPONENT_EXPANSIONS ||
      expandedLength > MAX_EXPANDED_LENGTH
    ) {
      // Past the budget, keep what the remaining uses wrap without expanding them.
      use.replaceWith(...use.childNodes);
      continue;
    }

    const template = parsed.createElement('template');
    template.innerHTML = source ?? '<slot></slot>';
    const nested = template.content.querySelectorAll('macro-component');
    pending.push(...nested);
    template.content.querySelector('slot')?.replaceWith(...use.childNodes);
    use.replaceWith(template.content);
  }

  for (const use of parsed.querySelectorAll('macro-style')) {
    const source = entry(library.styles, use.getAttribute('name'));
    if (source === undefined) {
      use.remove();
      continue;
    }

    const style = parsed.createElement('style');
    style.textContent = source;
    use.replaceWith(style);
  }
}
/**
 * Tells the host that its own document, not some page navigated to, has loaded.
 * It runs before any artifact code and removes itself, keeping the token in a
 * closure, so the artifact cannot hand it to another page. An artifact that
 * navigates while parsing never reaches its own load, so it sends nothing.
 */
const loadMarker = (token: string) =>
  `(function (host, token) {
    addEventListener('load', function () {
      host.postMessage({ macroArtifactLoaded: token }, '*');
    });
  })(parent, ${JSON.stringify(token)});
  document.currentScript.remove();`;

export const isArtifactLoadMarker = (data: unknown, token: string) =>
  !!data &&
  typeof data === 'object' &&
  'macroArtifactLoaded' in data &&
  data.macroArtifactLoaded === token;

/** Build the srcdoc. The parser never runs scripts, and the policy is parsed
 * first so that nothing in the artifact can run or load before it applies. */
export function composeArtifactDocument(
  html: string,
  tokens: Record<string, string>,
  library: ArtifactLibrary,
  loadToken: string
): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  expandLibrary(parsed, library);

  for (const refresh of parsed.querySelectorAll('meta[http-equiv="refresh" i]'))
    refresh.remove();

  const theme = parsed.createElement('style');
  theme.textContent = `:root{${Object.entries(tokens)
    .map(([token, value]) => `${token}:${value}`)
    .join(';')}}`;

  const policy = parsed.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = ARTIFACT_CSP;

  const marker = parsed.createElement('script');
  marker.textContent = loadMarker(loadToken);

  const bridge = parsed.createElement('script');
  bridge.textContent = KEY_BRIDGE;

  parsed.head.prepend(policy, theme, marker, bridge);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

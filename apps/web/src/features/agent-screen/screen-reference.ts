import { parseInternalAppLink } from '@core/util/macroAppUrl';

/** A reference to an agent computer's screen, by its harness. */
export type ScreenReference = { harnessId: string };

// Harness ids are UUIDs; anything else in that segment is not a screen.
const HARNESS_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The screen a link points at: an app link the app opens here (this origin,
 * as `parseInternalAppLink` decides; never another site) to
 * `/app/screen/<harnessId>`. Its query, such
 * as `mode=drive`, is dropped: a reference only ever opens to watch.
 * Undefined for any other link.
 */
export function parseScreenReference(url: string): ScreenReference | undefined {
  const absolute = url.startsWith('/app/')
    ? `${window.location.origin}${url}`
    : url;
  const link = parseInternalAppLink(absolute);
  if (!link) return undefined;
  const segment = /^\/screen\/([^/]+)\/?$/.exec(link.path)?.[1];
  if (!segment) return undefined;
  let harnessId: string;
  try {
    harnessId = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  if (!HARNESS_ID.test(harnessId)) return undefined;
  return { harnessId: harnessId.toLowerCase() };
}

/** The app's own path to a screen, on whatever origin the app runs. */
export function screenPath(reference: ScreenReference): string {
  return `/app/screen/${reference.harnessId}`;
}

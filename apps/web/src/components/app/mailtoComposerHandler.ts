import { globalSplitManager } from '@app/signal/splitLayout';
import { parseMailto } from '@block-email/util/mailto';
import { registerExternalUrlInterceptor } from '@core/util/url';

/**
 * Opens a `mailto:` URL in the in-app email composer, prefilling the
 * recipients. Returns false — so `openExternalUrl` falls through to opening the
 * URL normally (the OS mail client) — when the URL isn't a mailto or the split
 * manager isn't ready yet.
 */
function openMailtoInComposer(url: string): boolean {
  const parsed = parseMailto(url);
  if (!parsed) return false;
  const manager = globalSplitManager();
  if (!manager) return false;
  manager.openWithSplit({
    type: 'component',
    id: 'email-compose',
    params: parsed.to.length ? { initialTo: parsed.to } : undefined,
    preserveParams: true,
  });
  return true;
}

/**
 * Wires the mailto -> in-app composer handler into `openExternalUrl`. Injected
 * from the app layer (rather than imported by `@core/util/url`) so core stays
 * free of feature/app-layer deps. Call once at app startup.
 */
export function registerMailtoComposerHandler() {
  registerExternalUrlInterceptor(openMailtoInComposer);
}

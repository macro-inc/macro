import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Document } from './document';

/** One problem that keeps a published page from building. */
export interface PageProblem {
  /** The block it is in, such as `program tasks` or `client script`. */
  block?: string;
  /** What is wrong, with its line and column in that block. */
  message: string;
}

/**
 * How a published page's build went.
 *
 * - `built`: it built, and its programs run when someone opens it (a page
 *   with no programs or client script opens as it is).
 * - `failed`: it doesn't build; `problems` says why.
 * - `busy`: the build didn't finish in time. The page is saved; call
 *   `document.republishPage(html)` with the same page later to build it.
 * - `unavailable`: live pages aren't available to this account yet. The page
 *   is saved and opens as plain HTML; don't publish it again.
 */
export type PageBuildStatus = 'built' | 'failed' | 'busy' | 'unavailable';

/** A published page and what keeps it from building. */
export interface PagePublished {
  /** The HTML document, saved whether or not it builds. */
  document: Document;
  /** How its build went. */
  build: PageBuildStatus;
  /** Every problem in the page; empty unless `build` is `failed`. */
  problems: PageProblem[];
}

/** The page's source is over the 2 MiB a build reads. */
const PAGE_TOO_LARGE = 413;
/** Live pages are not rolled out to this account. */
const PAGES_UNAVAILABLE = 404;
/** The build's toolchain was busy past its deadline. */
const BUILD_BUSY = 503;

/**
 * Build the saved page and report its problems. The page is already saved,
 * so a build that can't run returns a status instead of throwing: a caller
 * that retried by publishing again would create a second document.
 */
export async function publishedPage(
  client: MacroClient,
  document: Document,
): Promise<PagePublished> {
  const response = await client.agentHarness.getDocumentBuild({
    path: { document_id: document.id },
  });
  const status = response.response?.status;
  if (status === PAGE_TOO_LARGE)
    return {
      document,
      build: 'failed',
      problems: [{ message: 'the page is over 2 MiB; make it smaller' }],
    };
  if (status === PAGES_UNAVAILABLE)
    return { document, build: 'unavailable', problems: [] };
  if (status === BUILD_BUSY) return { document, build: 'busy', problems: [] };

  const build = unwrap(response);
  // A page with no program or client blocks is shown as it is.
  if (build.status === 'built' || build.status === 'plain')
    return { document, build: 'built', problems: [] };

  const problems = build.diagnostics.map(({ file, message }) =>
    file ? { block: file, message } : { message },
  );
  return { document, build: 'failed', problems };
}

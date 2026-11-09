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

/** A published page and what keeps it from building. */
export interface PagePublished {
  /** The HTML document, saved whether or not it builds. */
  document: Document;
  /** Every problem in the page; empty means it built and its programs run. */
  problems: PageProblem[];
}

/** The page's source is over the 2 MiB a build reads. */
const PAGE_TOO_LARGE = 413;

/** Build the saved page and report its problems. */
export async function publishedPage(
  client: MacroClient,
  document: Document,
): Promise<PagePublished> {
  const response = await client.agentHarness.getDocumentBuild({
    path: { document_id: document.id },
  });
  if (response.response?.status === PAGE_TOO_LARGE)
    return {
      document,
      problems: [{ message: 'the page is over 2 MiB; make it smaller' }],
    };

  const build = unwrap(response);
  if (build.status === 'built') return { document, problems: [] };

  const problems = build.diagnostics.map(({ file, message }) =>
    file ? { block: file, message } : { message },
  );
  return { document, problems };
}

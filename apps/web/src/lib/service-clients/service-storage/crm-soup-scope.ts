import {
  hasIndependentRestSoupCursor,
  rememberIndependentRestSoupCursor,
  restSoupAstExcludesCrmContent,
} from '@graphql-cache/authority-scope';
import { crmAccessAuthority } from './crm-access-authority';

export function restSoupNeedsCrmProof(
  body: string,
  cursor: string | null
): boolean {
  if (cursor !== null) return !hasIndependentRestSoupCursor(body, cursor);
  try {
    return !restSoupAstExcludesCrmContent(JSON.parse(body));
  } catch {
    return true;
  }
}

/** Called at dispatch and completed only after a successful guarded decode.
 * Cursor witnesses share the existing bounded registry, and never survive login. */
export function beginRestSoupPage(body: string, cursor: string | null) {
  const independent = !restSoupNeedsCrmProof(body, cursor);
  const assertSession = crmAccessAuthority.captureSession();
  const isCurrent = () => {
    try {
      assertSession();
      return true;
    } catch {
      return false;
    }
  };
  return (nextCursor: unknown) => {
    if (independent)
      rememberIndependentRestSoupCursor(body, nextCursor, isCurrent);
  };
}

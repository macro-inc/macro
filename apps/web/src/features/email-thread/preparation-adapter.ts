import type { EmailPreparation } from '../email-message/context/email-preparation';
import { emailImagePolicy } from '../email-message/rendering-policy';
import { prepareThreads } from './preparation';
import { readThreadForPreparation } from './queries/preparation-source';

/** App wiring supplies authorized source loading and the current image policy. */
export function prepareEmailThreads(
  preparation: EmailPreparation,
  ids: readonly string[],
  priority: number,
  localOnly = false
): () => void {
  return prepareThreads(
    preparation,
    { read: readThreadForPreparation },
    emailImagePolicy,
    ids,
    priority,
    localOnly
  );
}

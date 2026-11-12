import type { InputFields, Intent } from './input';
import { recipientReferenceTerm, recipientTerms } from './recipients';
import { searchPeopleTerms } from './search';

/** Only the active form's current references, not a suggestion window/catalog. */
export function inputPeopleTerms(
  fields: InputFields,
  intent: Intent | undefined
): string[] {
  let terms: string[] = [];
  if (intent === 'email')
    terms = [fields.recipients, fields.cc, fields.bcc].flatMap(recipientTerms);
  else if (intent === 'message') terms = recipientTerms(fields.recipients);
  else if (intent === 'calendar') terms = recipientTerms(fields.guests);
  else if (intent === 'search') terms = searchPeopleTerms(fields.searchFilters);
  return terms.map(recipientReferenceTerm);
}

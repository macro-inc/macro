import { Contact } from '@contacts/Contact/Contact';
import { useBlockId } from '@core/block';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `contacts` feature package. All block-specific glue lives here; the
 * `contacts` package itself has zero block dependencies.
 */
export function ContactBlockAdapter() {
  const contactId = useBlockId();
  return <Contact contactId={contactId} />;
}

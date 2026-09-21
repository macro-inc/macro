import { CrmCopyLinkButton } from '@companies/components/CrmCopyLinkButton';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { Contact } from '@contacts/Contact/Contact';
import { useBlockId } from '@core/block';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `contacts` feature package. All block-specific glue lives here; the
 * `contacts` package itself has zero block dependencies.
 */
export function ContactBlockAdapter() {
  const contactId = useBlockId();
  return (
    <>
      <SplitHeaderRight>
        <HeaderIsland>
          <CrmCopyLinkButton type="contact" id={contactId} />
        </HeaderIsland>
      </SplitHeaderRight>
      <Contact contactId={contactId} />
    </>
  );
}

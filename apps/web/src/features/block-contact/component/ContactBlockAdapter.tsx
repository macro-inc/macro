import { CrmCopyLinkButton } from '@companies/components/CrmCopyLinkButton';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { Contact } from '@contacts/Contact/Contact';
import { useBlockId } from '@core/block';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `contacts` feature package. All block-specific glue lives here; the
 * `contacts` package itself has zero block dependencies.
 */
export function ContactBlockAdapter() {
  const contactId = useBlockId();
  const params = createParamsState();
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: params.navigate,
  });
  return (
    <>
      <SplitHeaderRight>
        <HeaderIsland>
          <CrmCopyLinkButton type="contact" id={contactId} />
        </HeaderIsland>
      </SplitHeaderRight>
      <ParamsProvider state={params}>
        <Contact contactId={contactId} />
      </ParamsProvider>
    </>
  );
}

import {
  Contact,
  type ContactSection,
  ContactTabs,
} from '@app/features/crm/crm-contact';
import { CrmCopyLinkButton } from '@app/features/crm/crm-link';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useBlockId } from '@core/block';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { createSignal } from 'solid-js';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `contacts` feature package. All block-specific glue lives here; the
 * `contacts` package itself has zero block dependencies.
 */
export function ContactBlockAdapter() {
  const contactId = useBlockId();
  const params = createParamsState();
  const [section, setSection] = createSignal<ContactSection>('overview');
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: params.navigate,
  });
  return (
    <>
      <SplitHeaderLeft>
        <CollapsibleHeaderItem
          id="contact-tabs"
          priority={1}
          containerClass="ph-no-capture min-w-0 shrink-0 h-full mx-2"
        >
          {(isCollapsed) => (
            <ContactTabs
              value={section()}
              onChange={setSection}
              compact={isCollapsed()}
            />
          )}
        </CollapsibleHeaderItem>
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <HeaderIsland>
          <CrmCopyLinkButton type="contact" id={contactId} />
        </HeaderIsland>
      </SplitHeaderRight>
      <ParamsProvider state={params}>
        <Contact contactId={contactId} section={section()} />
      </ParamsProvider>
    </>
  );
}

import {
  Contact,
  type ContactSection,
  ContactTabs,
  ContactVisibilityButton,
} from '@app/features/crm/crm-contact';
import { CrmCopyLinkButton } from '@app/features/crm/crm-link';
import { useOpenMergedRecord } from '@app/features/crm/crm-merged-record';
import {
  type CrmRecordBlockProps,
  createRecordSection,
  mergedRecordBlockContent,
} from '@app/features/crm/crm-record-block';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { CollapsibleHeaderItem } from '@components/app/split-layout/components/CollapsibleItem';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useBlockId } from '@core/block';
import {
  createParamsState,
  ParamsProvider,
  useResolvedParam,
} from '@core/component/ParamsProvider';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
import { Show } from 'solid-js';

/**
 * Legacy adapter: bridges the block/split-layout system to the standalone
 * `contacts` feature package. All block-specific glue lives here; the
 * `contacts` package itself has zero block dependencies.
 */
export function ContactBlockAdapter(props: CrmRecordBlockProps) {
  const contactId = useBlockId();
  const params = createParamsState();
  const sentComment = props[COMMENT_LINK_PARAM];
  if (sentComment) params.navigate({ [COMMENT_LINK_PARAM]: sentComment });
  const shownComment = useResolvedParam(params, COMMENT_LINK_PARAM);
  const [section, setSection] = createRecordSection({
    type: 'contact',
    id: contactId,
  });
  const panel = useSplitPanelOrThrow();
  const chooseSection = (next: ContactSection) => {
    setSection(next);
    // Opening a file swaps this block out without leaving its history
    // entry, which is when entry state is otherwise captured.
    panel.handle.captureEntryState();
  };
  const openMerged = useOpenMergedRecord((survivor) =>
    panel.handle.replace({
      next: mergedRecordBlockContent(survivor, {
        section: section(),
        commentId: shownComment(),
      }),
      mergeHistory: true,
    })
  );
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: params.navigate,
  });
  return (
    <>
      <Show when={crmAccessAllowed()}>
        <SplitHeaderLeft>
          <CollapsibleHeaderItem
            id="contact-tabs"
            priority={1}
            containerClass="ph-no-capture min-w-0 h-full mx-2 touch:mx-0"
          >
            {(isCollapsed) => (
              <div
                class={
                  isCollapsed()
                    ? 'min-w-0 not-touch:overflow-x-auto not-touch:scrollbar-hidden'
                    : 'shrink-0'
                }
              >
                <ContactTabs
                  value={section()}
                  onChange={chooseSection}
                  compact={isCollapsed()}
                />
              </div>
            )}
          </CollapsibleHeaderItem>
        </SplitHeaderLeft>
        <SplitHeaderRight>
          <HeaderIsland class="p-0">
            <HeaderActionGroup label="Contact actions">
              <CrmCopyLinkButton grouped type="contact" id={contactId} />
              <ContactVisibilityButton grouped contactId={contactId} />
            </HeaderActionGroup>
          </HeaderIsland>
        </SplitHeaderRight>
      </Show>
      <ParamsProvider state={params}>
        <Contact
          contactId={contactId}
          section={section()}
          onMerged={(id) => openMerged({ type: 'contact', id })}
        />
      </ParamsProvider>
    </>
  );
}

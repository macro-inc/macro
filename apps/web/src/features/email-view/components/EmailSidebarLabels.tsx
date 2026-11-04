import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import TagSimpleIcon from '@icon/system/regular/tag-simple.svg';
import { selectSidebarTag } from '@property/tags/SidebarTagsSection';
import { useEmailLabelNamesQuery } from '@queries/email/labels';
import { pressHandlers } from '@ui';
import { For, Show } from 'solid-js';
import { LABEL_FACET_ID } from '../constants';
import { useEmailView } from '../email-view-context';

const SECTION_ID = 'labels';

/**
 * The inboxes' Gmail labels and Outlook categories. Choosing one shows the
 * mail carrying it, as a sidebar tag does; there is no editing, since Macro
 * never writes labels back to the provider.
 */
export function EmailSidebarLabels(props: { onNavigate?: () => void }) {
  const { state, showLabels, isSidebarSectionOpen, setSidebarSectionOpen } =
    useEmailView();
  const labelNames = useEmailLabelNamesQuery();
  const names = () => (labelNames.isSuccess ? labelNames.data : []);
  const activeNames = () => state.facets[LABEL_FACET_ID] ?? [];

  return (
    <Show when={names().length > 0}>
      <CollapsibleSection.Root
        open={isSidebarSectionOpen(SECTION_ID)}
        onOpenChange={(open) => setSidebarSectionOpen(SECTION_ID, open)}
      >
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger class="flex-1">
            <span class="min-w-0 truncate">Labels</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label="Email labels">
            <For each={names()}>
              {(name) => (
                <ViewSidebar.Item
                  active={activeNames().includes(name)}
                  title={name}
                  {...pressHandlers(() => {
                    showLabels(selectSidebarTag(activeNames(), name));
                    props.onNavigate?.();
                  })}
                >
                  <ViewSidebar.Icon>
                    <TagSimpleIcon class="size-4" />
                  </ViewSidebar.Icon>
                  <span class="truncate">{name}</span>
                </ViewSidebar.Item>
              )}
            </For>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}

import { ViewBreadcrumbs } from '@app/components/view-shell';
import { ProjectDetail } from '@app/features/projects/project-detail';
import { t } from '@app/lib/i18n';
import { createSearchParams } from '@app/lib/split-router';
import { PreviewFrame } from '@components/app/PreviewPanel';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { homeProjectSearch } from '../home-route-schema';
import { useHomeView } from '../home-view-context';

/** The existing project detail, hosted by Home instead of the Tasks workspace. */
export function HomeProjectPreview() {
  const panel = useSplitPanelOrThrow();
  const { previewTarget, previewNavigationRequest, closePreview } =
    useHomeView();
  const [search, setSearch] = createSearchParams(homeProjectSearch);
  const id = () => previewTarget()!.blockId;
  const value = () => `initiative:${id()}`;
  // Home's list registers the same entity commands on the split's scope, so
  // the project's live in a child scope, as Home's document previews' do.
  const [attachHotkeys, hotkeyScope] = useHotkeyDOMScope('home-project');

  return (
    <PreviewFrame
      splitPanelContext={panel}
      hideHeader
      locationKey={() =>
        `${id()}:${search.section}:${search.discussionId}:${previewNavigationRequest()}`
      }
    >
      <ViewBreadcrumbs.Root
        value={value()}
        onChange={(next) => {
          if (next === 'home') closePreview();
        }}
      >
        <ViewBreadcrumbs.Item value="home" metadata={null} order={0}>
          {(item) => (
            <ViewBreadcrumbs.ReturnButton onClick={item.onSelect}>
              {t('nav.home')}
            </ViewBreadcrumbs.ReturnButton>
          )}
        </ViewBreadcrumbs.Item>
        <SidePanel.Root>
          <div ref={attachHotkeys} class="flex h-full min-h-0 flex-col">
            <ProjectDetail
              hotkeyScope={hotkeyScope}
              navigationRequest={previewNavigationRequest()}
              route={{
                id: id(),
                section: search.section,
                discussionId: search.discussionId,
              }}
              breadcrumb={{
                entry: {
                  value: value(),
                  data: { type: 'initiative', id: id() },
                },
                order: 1,
              }}
              onSectionChange={(section) =>
                setSearch({ section, discussionId: undefined })
              }
              onDelete={closePreview}
            />
          </div>
        </SidePanel.Root>
      </ViewBreadcrumbs.Root>
    </PreviewFrame>
  );
}

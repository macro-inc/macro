import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { useViewTabHotkeys } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { createSignal, Show } from 'solid-js';
import type { ProjectSection } from '../core/project';
import type { ProjectDetailHeaderProps } from '../project-detail';
import { ProjectTitleMenu } from '../project-title-menu';
import { ProjectSectionTabs } from './shared/project-section-tabs';

const PROJECT_SECTIONS: readonly ProjectSection[] = ['overview', 'tasks'];

export function ProjectDetailHeader(props: ProjectDetailHeaderProps) {
  const [tabs, setTabs] = createSignal<HTMLElement>();
  const panel = useSplitPanel();
  if (panel) {
    useViewTabHotkeys<ProjectSection>({
      scopeId: panel.splitHotkeyScope,
      enabled: panel.isPanelActive,
      tabs,
      ids: () => PROJECT_SECTIONS,
      activeId: () => props.section,
      setActiveId: props.onSectionChange,
      label: (section) =>
        section === 'overview'
          ? t('tabs.project-overview')
          : t('tabs.project-tasks'),
    });
  }

  return (
    <EntityDetailTopBar
      titleMenu={
        <Show when={props.source.project()}>
          {(project) => (
            <ProjectTitleMenu
              project={project()}
              source={props.source}
              commands={props.commands}
              section={props.section}
              onShare={props.onShare}
              onDelete={props.onDelete}
            />
          )}
        </Show>
      }
      navigation={(compact) => (
        <ProjectSectionTabs
          ref={setTabs}
          compact={compact}
          section={props.section}
          onChange={props.onSectionChange}
        />
      )}
    >
      <Show when={props.source.project()}>
        {(project) => (
          <ShareTrigger
            onClick={props.onShare}
            id={project().id}
            blockType="initiative"
            hotkeyScope={props.hotkeyScope}
          />
        )}
      </Show>
    </EntityDetailTopBar>
  );
}

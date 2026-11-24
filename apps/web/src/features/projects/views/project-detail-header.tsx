import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { useViewTabHotkeys } from '@app/components/view-shell';
import {
  splitRootScope,
  useSplitPanel,
} from '@components/app/split-layout/layoutUtils';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { createSignal, Show } from 'solid-js';
import type { ProjectSection } from '../core/project';
import type { ProjectDetailHeaderProps } from '../project-detail';
import { ProjectTitleMenu } from '../project-title-menu';
import {
  ProjectSectionTabs,
  projectSectionLabel,
} from './shared/project-section-tabs';

export function ProjectDetailHeader(props: ProjectDetailHeaderProps) {
  const [tabs, setTabs] = createSignal<HTMLElement>();
  const panel = useSplitPanel();
  if (panel) {
    useViewTabHotkeys<ProjectSection>({
      scopeId: splitRootScope(panel),
      enabled: panel.isPanelActive,
      tabs,
      ids: () => props.sections,
      activeId: () => props.section,
      setActiveId: props.onSectionChange,
      label: projectSectionLabel,
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
          sections={props.sections}
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

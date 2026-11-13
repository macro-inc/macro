import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { Show } from 'solid-js';
import type { ProjectDetailHeaderProps } from '../project-detail';
import { ProjectTitleMenu } from '../project-title-menu';
import { ProjectSectionTabs } from './shared/project-section-tabs';

export function ProjectDetailHeader(props: ProjectDetailHeaderProps) {
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

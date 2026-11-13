import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { Show } from 'solid-js';
import { ProjectTitleMenu } from '../../components/project-title-menu';
import type { ProjectDetailHeaderProps } from '../../project-detail';
import { ProjectSectionTabs } from '../shared/project-section-tabs';

export function MobileProjectDetailHeader(props: ProjectDetailHeaderProps) {
  return (
    <>
      <MobileHeader trailing={<MobileHeader.Info />}>
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
      </MobileHeader>
      <div class="shrink-0 px-4 pb-2 pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.75rem)]">
        <ProjectSectionTabs
          compact={() => false}
          section={props.section}
          onChange={props.onSectionChange}
        />
      </div>
    </>
  );
}
